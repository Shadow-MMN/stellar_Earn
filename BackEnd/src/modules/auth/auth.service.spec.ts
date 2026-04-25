import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import {
  RefreshToken,
  RefreshTokenRevokeReason,
} from './entities/refresh-token.entity';
import { Role } from '../../common/enums/role.enum';

const STELLAR_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const sha256 = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

describe('AuthService — refresh token rotation', () => {
  let service: AuthService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let jwt: { sign: jest.Mock };
  let config: { get: jest.Mock };
  let storedRows: Map<string, RefreshToken>;

  const configValues: Record<string, string> = {
    JWT_ACCESS_TOKEN_EXPIRATION: '15m',
    JWT_REFRESH_TOKEN_EXPIRATION: '7d',
    ADMIN_ADDRESSES: '',
  };

  beforeEach(async () => {
    storedRows = new Map();

    repo = {
      create: jest.fn().mockImplementation((dto: Partial<RefreshToken>) => {
        return {
          id: crypto.randomUUID(),
          replacedByTokenId: null,
          isRevoked: false,
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
          ...dto,
        } as RefreshToken;
      }),
      save: jest.fn().mockImplementation((entity: RefreshToken) => {
        storedRows.set(entity.id, { ...entity });
        return Promise.resolve(entity);
      }),
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
          for (const row of storedRows.values()) {
            const indexed = row as unknown as Record<string, unknown>;
            const matches = Object.entries(where).every(
              ([k, v]) => indexed[k] === v,
            );
            if (matches) return Promise.resolve(row);
          }
          return Promise.resolve(null);
        }),
      update: jest
        .fn()
        .mockImplementation(
          (
            criteria: Record<string, unknown>,
            patch: Partial<RefreshToken>,
          ) => {
            let affected = 0;
            for (const row of storedRows.values()) {
              const indexed = row as unknown as Record<string, unknown>;
              const matches = Object.entries(criteria).every(
                ([k, v]) => indexed[k] === v,
              );
              if (matches) {
                Object.assign(row, patch);
                affected += 1;
              }
            }
            return Promise.resolve({ affected });
          },
        ),
    };

    jwt = {
      sign: jest
        .fn()
        .mockImplementation(
          (_payload: unknown, opts: { expiresIn: string }) =>
            `signed.${opts.expiresIn}`,
        ),
    };

    config = {
      get: jest
        .fn()
        .mockImplementation((key: string, fallback?: string) => {
          return configValues[key] ?? fallback ?? '';
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        { provide: getRepositoryToken(RefreshToken), useValue: repo },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('generateTokens', () => {
    it('persists only a SHA-256 hash of the refresh token, never the plaintext', async () => {
      const result = await service.generateTokens(
        STELLAR_ADDRESS,
        Role.USER,
      );

      expect(storedRows.size).toBe(1);
      const [row] = Array.from(storedRows.values());

      // The wire-format token is "<rowId>.<secret>". The DB must hold
      // sha256(secret) — and crucially must NOT contain the secret.
      const [, secret] = result.refreshToken.split('.');
      expect(secret).toBeTruthy();
      expect(row.tokenHash).toBe(sha256(secret));
      expect(row.tokenHash).not.toBe(secret);
      expect(JSON.stringify(row)).not.toContain(secret);
    });

    it('starts a fresh token family on login but reuses the supplied family id on rotation', async () => {
      const initial = await service.generateTokens(
        STELLAR_ADDRESS,
        Role.USER,
      );
      const [first] = Array.from(storedRows.values());
      expect(first.familyId).toMatch(
        /^[0-9a-f-]{36}$/i,
      );

      const rotated = await service.generateTokens(
        STELLAR_ADDRESS,
        Role.USER,
        first.familyId,
      );
      const familyIds = Array.from(storedRows.values()).map(
        (r) => r.familyId,
      );
      expect(familyIds).toEqual([first.familyId, first.familyId]);
      expect(initial.refreshToken).not.toBe(rotated.refreshToken);
    });
  });

  describe('refreshTokens', () => {
    it('rotates the presented token: marks it revoked with reason "rotated" and links to the successor', async () => {
      const initial = await service.generateTokens(
        STELLAR_ADDRESS,
        Role.USER,
      );
      const [originalRow] = Array.from(storedRows.values());

      const result = await service.refreshTokens(initial.refreshToken);

      const after = storedRows.get(originalRow.id)!;
      expect(after.isRevoked).toBe(true);
      expect(after.revokedReason).toBe(RefreshTokenRevokeReason.ROTATED);
      expect(after.revokedAt).toBeInstanceOf(Date);

      // The successor row must exist, must share the family, and must be
      // pointed to by the consumed row.
      const successorId = result.refreshToken.split('.')[0];
      const successor = storedRows.get(successorId);
      expect(successor).toBeDefined();
      expect(successor!.familyId).toBe(originalRow.familyId);
      expect(after.replacedByTokenId).toBe(successorId);

      // And the new refresh token value really is new.
      expect(result.refreshToken).not.toBe(initial.refreshToken);
    });

    it('treats reuse of a rotated token as theft: revokes the entire family', async () => {
      const initial = await service.generateTokens(
        STELLAR_ADDRESS,
        Role.USER,
      );
      const [familyRoot] = Array.from(storedRows.values());

      // Legitimate rotation #1 → produces token B (family member).
      const second = await service.refreshTokens(initial.refreshToken);
      // Legitimate rotation #2 → produces token C (family member).
      const third = await service.refreshTokens(second.refreshToken);

      // Attacker (or careless retry) replays the *original* token. Every
      // row in the family — including the currently-active token C — must
      // be revoked under reason "reuse_detected".
      await expect(
        service.refreshTokens(initial.refreshToken),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const familyRows = Array.from(storedRows.values()).filter(
        (r) => r.familyId === familyRoot.familyId,
      );
      expect(familyRows.length).toBeGreaterThanOrEqual(3);
      for (const row of familyRows) {
        expect(row.isRevoked).toBe(true);
      }
      // The most recent token (third) was active before the replay — its
      // revoke reason should now be the cascade reason, not "rotated".
      const thirdId = third.refreshToken.split('.')[0];
      expect(storedRows.get(thirdId)!.revokedReason).toBe(
        RefreshTokenRevokeReason.REUSE_DETECTED,
      );

      // And a subsequent attempt with the (just-cascaded) latest token must
      // also fail — the family is dead until the user re-authenticates.
      await expect(
        service.refreshTokens(third.refreshToken),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown / malformed refresh token without touching the DB', async () => {
      await expect(
        service.refreshTokens('not-a-real-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.refreshTokens('uuid.does-not-match-any-hash'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired refresh token', async () => {
      const initial = await service.generateTokens(
        STELLAR_ADDRESS,
        Role.USER,
      );
      const [row] = Array.from(storedRows.values());
      row.expiresAt = new Date(Date.now() - 1_000);

      await expect(
        service.refreshTokens(initial.refreshToken),
      ).rejects.toThrow('Refresh token has expired');
    });
  });

  describe('revokeToken', () => {
    it('records revokedAt and revoke reason on single-token logout', async () => {
      await service.generateTokens(STELLAR_ADDRESS, Role.USER);
      const [row] = Array.from(storedRows.values());

      await service.revokeToken(STELLAR_ADDRESS, row.id);

      const after = storedRows.get(row.id)!;
      expect(after.isRevoked).toBe(true);
      expect(after.revokedAt).toBeInstanceOf(Date);
      expect(after.revokedReason).toBe(RefreshTokenRevokeReason.LOGOUT);
    });

    it('logout-all marks every active token as revoked with reason "logout_all"', async () => {
      await service.generateTokens(STELLAR_ADDRESS, Role.USER);
      await service.generateTokens(STELLAR_ADDRESS, Role.USER);

      await service.revokeToken(STELLAR_ADDRESS);

      for (const row of storedRows.values()) {
        expect(row.isRevoked).toBe(true);
        expect(row.revokedReason).toBe(
          RefreshTokenRevokeReason.LOGOUT_ALL,
        );
      }
    });

    it('throws NotFoundException when a specific token id does not exist', async () => {
      await expect(
        service.revokeToken(STELLAR_ADDRESS, crypto.randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
