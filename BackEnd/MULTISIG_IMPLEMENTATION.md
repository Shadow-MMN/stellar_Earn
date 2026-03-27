# Multi-Signature Wallet Implementation

## Overview

This document describes the multi-signature (multi-sig) wallet system for the StellarEarn platform. Multi-sig wallets provide enhanced security for high-value transactions and enterprise use cases by requiring multiple approvals before funds can be released.

## Architecture

### Entities

The multi-sig system is built on four core entities:

#### 1. **MultiSigWallet**
- Represents an organizational multi-sig wallet
- Stores threshold requirement and signer count
- Tracks statistics: total transactions, approved amount
- Status: ACTIVE, INACTIVE, SUSPENDED

```typescript
{
  id: string;
  organizationId: string;
  walletAddress: string;
  name?: string;
  threshold: number; // Number of approvals required
  totalSigners: number; // Max signers allowed
  status: MultiSigWalletStatus;
  totalTransactions: number;
  approvedTransactions: number;
  totalAmountApproved: number;
}
```

#### 2. **MultiSigSigner**
- Represents an individual signer in a wallet
- Role-based access control (OWNER, ADMIN, APPROVER, VIEWER)
- Tracks approval/rejection statistics
- Status: ACTIVE, INACTIVE, REMOVED

```typescript
{
  id: string;
  multiSigWalletId: string;
  signerAddress: string;
  role: SignerRole; // OWNER | ADMIN | APPROVER | VIEWER
  status: SignerStatus;
  approvalCount: number;
  rejectionCount: number;
  lastApprovalAt?: Date;
}
```

#### 3. **MultiSigTransaction**
- Represents a transaction pending approval
- Can be payouts, threshold updates, signer changes, etc.
- Tracks status and approval count
- Expires after 7 days

```typescript
{
  id: string;
  multiSigWalletId: string;
  transactionType: MultiSigTransactionType;
  status: MultiSigTransactionStatus;
  destinationAddress: string;
  amount?: number;
  asset?: string;
  approvalsReceived: number;
  rejectionsReceived: number;
  threshold: number;
  expiresAt: Date;
  stellarTransactionHash?: string;
}
```

#### 4. **MultiSigSignature**
- Represents a single signer's approval/rejection
- Status: PENDING, SIGNED, REJECTED, EXPIRED

```typescript
{
  id: string;
  multiSigTransactionId: string;
  signerAddress: string;
  status: SignatureStatus;
  signature?: string;
  comment?: string;
  signedAt?: Date;
  rejectionReason?: string;
}
```

## Core Services

### MultiSigWalletService

Handles wallet and signer management, transaction creation, and signature collection.

#### Key Methods:

```typescript
// Wallet Management
createWallet(createDto: CreateMultiSigWalletDto, userId: string): Promise<MultiSigWallet>
addSigner(addDto: AddSignerDto, userId: string): Promise<MultiSigSigner>
removeSigner(walletId: string, signerAddress: string, userId: string): Promise<MultiSigSigner>
updateThreshold(updateDto: UpdateThresholdDto, userId: string): Promise<MultiSigWallet>

// Transaction Management
createTransaction(createDto: CreateMultiSigTransactionDto, userId: string): Promise<MultiSigTransaction>
approveTransaction(approveDto: ApproveTransactionDto, userId: string): Promise<{transaction, approved}>
rejectTransaction(rejectDto: RejectTransactionDto, userId: string): Promise<MultiSigTransaction>

// Query Methods
getWalletDetails(walletId: string): Promise<{wallet, signers, activeSignerCount}>
getPendingTransactions(walletId: string): Promise<MultiSigTransaction[]>
getTransactionSignatures(transactionId: string): Promise<MultiSigSignature[]>
getWalletStats(walletId: string): Promise<WalletStats>
```

### MultiSigPayoutService

Integrates multi-sig workflows with the payout system for secure high-value payouts.

#### Key Methods:

```typescript
// Payout Escrow
createPayoutEscrow(payoutId, walletId, destination, amount, userId): Promise<MultiSigPayoutEscrow>
checkPayoutApprovalStatus(payoutId): Promise<ApprovalStatus>
processApprovedPayout(transactionId): Promise<Payout>
handleRejectedPayout(transactionId, reason): Promise<Payout>

// Dashboard
getPayoutApprovalDashboard(walletId): Promise<DashboardData>
```

## Workflows

### Creating a Multi-Sig Wallet

```typescript
const wallet = await multiSigService.createWallet({
  organizationId: 'org-123',
  walletAddress: 'GBZXN7...',
  name: 'Enterprise Payout Wallet',
  threshold: 2, // Require 2/3 approvals
  totalSigners: 3,
}, userId);
```

### Adding Signers

```typescript
const signer1 = await multiSigService.addSigner({
  multiSigWalletId: wallet.id,
  signerAddress: 'GCZST3...',
  signerName: 'Finance Manager',
  role: SignerRole.APPROVER,
}, userId);

const signer2 = await multiSigService.addSigner({
  multiSigWalletId: wallet.id,
  signerAddress: 'GBZXN7...',
  signerName: 'CFO',
  role: SignerRole.APPROVER,
}, userId);
```

### Creating and Approving Transactions

#### 1. Initiate Transaction
```typescript
const tx = await multiSigService.createTransaction({
  multiSigWalletId: wallet.id,
  destinationAddress: 'GCZST3...',
  amount: 1000,
  asset: 'XLM',
  description: 'Quest reward payout',
}, userId);

// Automatically creates PENDING signatures for all approvers
```

#### 2. Approve by Signer 1
```typescript
const result = await multiSigService.approveTransaction({
  multiSigTransactionId: tx.id,
  signerAddress: 'GBZXN7...',
  comment: 'Verified correct amounts',
}, userId);

console.log(result.approved); // false - still needs 1 more approval
```

#### 3. Approve by Signer 2 (Threshold Met)
```typescript
const result = await multiSigService.approveTransaction({
  multiSigTransactionId: tx.id,
  signerAddress: 'GCZST3...',
  comment: 'Approved',
}, userId);

console.log(result.approved); // true - transaction ready to execute
// Event 'multisig.transaction.approved_complete' emitted
```

### Multi-Sig Payouts

#### Payout with Multi-Sig Requirement

```typescript
// Step 1: Create payout record
const payout = await payoutsService.createPayout({
  stellarAddress: 'GCZST3...',
  amount: 1000,
  questId: 'quest-123',
  submissionId: 'submission-456',
});

// Step 2: User claims payout (triggers escrow)
const payoutEscrow = await multiSigPayoutService.createPayoutEscrow(
  payout.id,
  wallet.id,
  payout.stellarAddress,
  payout.amount,
  userId,
);

// Payout status: PENDING → AWAITING_APPROVAL

// Step 3: Signers approve the escrow transaction
// (See workflows above)

// Step 4: When threshold met, payout auto-processes
// Payout status: AWAITING_APPROVAL → PROCESSING → COMPLETED
```

#### Dashboard View

```typescript
const dashboard = await multiSigPayoutService.getPayoutApprovalDashboard(walletId);

// Returns:
{
  walletAddress: 'GBZXN7...',
  threshold: 2,
  totalSigners: 3,
  pendingPayouts: [
    {
      payoutId: 'payout-123',
      amount: 1000,
      approvalsReceived: 1,
      remainingApprovals: 1,
      expiresAt: Date,
    }
  ],
  pendingCount: 5,
  approvedPayouts: [...],
  approvedCount: 3,
}
```

## Events

The multi-sig system emits domain events for integration:

### Wallet Events
- `multisig.wallet.created` - New wallet created
- `multisig.signer.added` - Signer added to wallet
- `multisig.signer.removed` - Signer removed from wallet
- `multisig.threshold.updated` - Threshold changed

### Transaction Events
- `multisig.transaction.created` - Transaction pending approval
- `multisig.transaction.approved` - Single approval received
- `multisig.transaction.approved_complete` - Threshold met, ready to execute
- `multisig.transaction.rejected` - Transaction rejected

### Payout Events
- `multisig.payout.escrow_created` - Payout placed in escrow
- `multisig.payout.approved` - Payout approved by signers
- `multisig.payout.rejected` - Payout rejected by signers

### Event Handlers
`MultiSigWebhookHandler` listens to events and:
- Auto-processes approved payouts
- Updates payout status on rejection
- Logs audit trail

## Security Considerations

1. **Threshold Enforcement**
   - Transactions only execute when approval count >= threshold
   - Cannot lower threshold below required approvals

2. **Signer Management**
   - Removed signers cannot approve new transactions
   - Each signer can only vote once per transaction
   - Approval count tracked per signer

3. **Transaction Expiry**
   - Transactions expire after 7 days
   - No approvals accepted after expiry
   - Expired transactions marked as EXPIRED

4. **Audit Trail**
   - All signer actions logged with timestamps
   - Approval/rejection statistics maintained
   - Full transaction history preserved

5. **Role-Based Access**
   - OWNER: Full control
   - ADMIN: Manage signers and thresholds
   - APPROVER: Can approve/reject transactions
   - VIEWER: Read-only access

## Database Schema

### Indexes for Performance
- `multisig_wallets`: (organizationId, walletAddress) UNIQUE
- `multisig_signers`: (multiSigWalletId, signerAddress) UNIQUE
- `multisig_signers`: (multiSigWalletId, status)
- `multisig_transactions`: (multiSigWalletId, status)
- `multisig_transactions`: (multiSigWalletId, createdAt)
- `multisig_signatures`: (multiSigTransactionId, signerAddress) UNIQUE
- `multisig_signatures`: (multiSigTransactionId, status)

## Integration with Payouts

### Flow Diagram
```
User Claims Payout
    ↓
Create Payout (PENDING)
    ↓
Create Multi-Sig Escrow (AWAITING_APPROVAL)
    ↓
Send to Signers for Approval
    ↓
Approvals Collected
    ↓
Threshold Met?
    ├─ YES → Process Payout (PROCESSING → COMPLETED)
    └─ NO → Await More Approvals
    ↓
Timeout (7 days)?
    ├─ YES → Reject Payout (FAILED)
    └─ NO → Continue Awaiting
```

## Example: Enterprise Payout Workflow

```typescript
// 1. Admin sets up enterprise wallet (2-of-3 multi-sig)
const wallet = await multiSigService.createWallet({
  organizationId: 'acme-corp',
  walletAddress: 'G...',
  threshold: 2,
  totalSigners: 3,
}, adminUserId);

// 2. Add three authorized signers
await multiSigService.addSigner({
  multiSigWalletId: wallet.id,
  signerAddress: 'finance-manager',
  role: SignerRole.APPROVER,
}, adminUserId);
// ... add 2 more signers

// 3. User completes quest and claims payout
const payout = await payoutsService.claimPayout({
  submissionId: 'sub-123',
  stellarAddress: 'user-wallet',
}, userId);

// 4. Payout automatically goes to multi-sig escrow
const escrow = await multiSigPayoutService.createPayoutEscrow(
  payout.id,
  wallet.id,
  payout.stellarAddress,
  payout.amount,
  systemUserId,
);

// 5. Finance Manager approves
await multiSigService.approveTransaction({
  multiSigTransactionId: escrow.multiSigTransactionId,
  signerAddress: 'finance-manager',
  comment: 'Verified completion',
}, managerId);

// 6. CFO approves (threshold met!)
const result = await multiSigService.approveTransaction({
  multiSigTransactionId: escrow.multiSigTransactionId,
  signerAddress: 'cfo',
  comment: 'Approved',
}, cfoId);

// result.approved === true
// Webhook handler auto-processes payout
// Payout status: COMPLETED
// User receives funds on Stellar network
```

## API Endpoints (Future)

```
POST   /api/v1/multisig/wallets - Create wallet
GET    /api/v1/multisig/wallets/:id - Get wallet details
POST   /api/v1/multisig/wallets/:id/signers - Add signer
DELETE /api/v1/multisig/wallets/:id/signers/:signer - Remove signer
PUT    /api/v1/multisig/wallets/:id/threshold - Update threshold

POST   /api/v1/multisig/transactions - Create transaction
GET    /api/v1/multisig/transactions/:id - Get transaction
POST   /api/v1/multisig/transactions/:id/approve - Approve
POST   /api/v1/multisig/transactions/:id/reject - Reject
GET    /api/v1/multisig/transactions/:id/signatures - Get signatures

GET    /api/v1/multisig/wallets/:id/stats - Wallet statistics
GET    /api/v1/multisig/wallets/:id/pending - Pending transactions
GET    /api/v1/multisig/payouts/dashboard - Approval dashboard
```

## Testing

Run tests:
```bash
npm run test -- multisig-wallet.service
npm run test -- multisig-payout.service
npm run test:e2e
```

Test coverage includes:
- Wallet creation and validation
- Signer management
- Transaction approval workflows
- Threshold enforcement
- Event emission
- Payout integration
- Error handling

## Future Enhancements

1. **Hardware Wallet Integration**
   - Support for hardware wallets as signers
   - Enhanced cryptographic verification

2. **Time Locks**
   - Delayed execution after approval
   - Gradual release schedules

3. **Emergency Controls**
   - Fast-track approvals for emergency payouts
   - Tiered thresholds by amount

4. **Advanced Reporting**
   - Approval analytics dashboard
   - Signature patterns and anomalies
   - Audit export functionality

5. **Smart Contracts**
   - On-chain multi-sig contract verification
   - Escrow enforcement via Soroban

## References

- [Stellar Account Structure](https://developers.stellar.org/docs/fundamentals-and-concepts/stellar-data-structures/accounts)
- [Multi-Signature Stellar Accounts](https://developers.stellar.org/docs/learn/encyclopedia/multi-sig)
