use soroban_sdk::{contracttype, Address, BytesN, String, Symbol, Vec, U256};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Quest {
    pub id: Symbol,
    pub creator: Address,
    pub reward_asset: Address,
    pub reward_amount: i128,
    pub verifier: Address,
    pub deadline: u64,
    pub status: QuestStatus,
    pub total_claims: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Submission {
    pub quest_id: Symbol,
    pub submitter: Address,
    pub proof_hash: BytesN<32>,
    pub status: SubmissionStatus,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum QuestStatus {
    Active,
    Paused,
    Completed,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubmissionStatus {
    Pending,
    Approved,
    Rejected,
    Paid,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserStats {
    pub xp: u64,
    pub level: u32,
    pub quests_completed: u32,
    pub badges: Vec<Badge>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Badge {
    Rookie,
    Explorer,
    Veteran,
    Master,
    Legend,
}

//================================================================================
// Batch operation input types (gas-optimized multi-item operations)
//================================================================================

/// Single quest registration input for batch registration.
/// Creator is implied from auth in register_quests_batch.
/// Platform-wide aggregated statistics.
///
/// Updated atomically on every quest creation, submission, and claim.
/// Queried via `EarnQuestContract::get_platform_stats()`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchQuestInput {
    pub id: Symbol,
    pub reward_asset: Address,
    pub reward_amount: i128,
    pub verifier: Address,
    pub deadline: u64,
}

/// Single approval input for batch approval.
/// Verifier is implied from auth in approve_submissions_batch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchApprovalInput {
    pub quest_id: Symbol,
    pub submitter: Address,
}

/// Description storage mode for quest metadata.
/// Inline is simpler; hash reference is cheaper for large content.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MetadataDescription {
    Inline(String),
    Hash(BytesN<32>),
}

/// Rich quest metadata shown to users.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuestMetadata {
    pub title: String,
    pub description: MetadataDescription,
    pub requirements: Vec<String>,
    pub category: String,
    pub tags: Vec<String>,
}
/// Escrow tracks tokens locked per quest.
/// Created when a creator calls deposit_escrow().
/// Updated when payouts happen or funds are refunded.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowInfo {
    /// Which quest this escrow belongs to
    pub quest_id: Symbol,
    /// Who deposited (must be quest creator)
    pub depositor: Address,
    /// Which token is held
    pub token: Address,
    /// Total tokens deposited (cumulative, includes top-ups)
    pub total_deposited: i128,
    /// Total tokens paid out to quest completers
    pub total_paid_out: i128,
    /// Total tokens refunded back to creator
    pub total_refunded: i128,
    /// Whether this escrow is still active
    pub is_active: bool,
    /// Ledger timestamp when the escrow was first created
    pub created_at: u64,
    /// Number of deposits made (1 = initial, >1 = top-ups)
    pub deposit_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreatorStats {
    pub quests_created: u64,
    pub total_rewards_posted: u128,
    pub total_submissions_received: u64,
    pub total_claims_paid: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformStats {
    pub total_quests_created: u64,
    pub total_submissions: u64,
    pub total_rewards_distributed: u128,
    pub total_active_users: u64,
    pub total_rewards_claimed: u64,
}

//================================================================================
// Oracle Types and Interface
//================================================================================

/// Price data from an oracle
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub base_asset: Address,
    pub quote_asset: Address,
    pub price: U256,
    pub decimals: u32,
    pub timestamp: u64,
    pub confidence: u32, // 0-100 percentage confidence score
}

/// Oracle provider types
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OracleType {
    StellarAsset,
    StellarOracle,
    Custom,
}

/// Oracle configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleConfig {
    pub oracle_address: Address,
    pub oracle_type: OracleType,
    pub max_age_seconds: u64,
    pub min_confidence: u32,
    pub is_active: bool,
}

/// Price feed request
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceFeedRequest {
    pub base_asset: Address,
    pub quote_asset: Address,
    pub max_age_seconds: u64,
}

/// Oracle response wrapper
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleResponse {
    pub price_data: PriceData,
    pub oracle_address: Address,
    pub response_timestamp: u64,
}

/// Oracle aggregation result for multiple sources
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregatedPrice {
    pub base_asset: Address,
    pub quote_asset: Address,
    pub weighted_price: U256,
    pub decimals: u32,
    pub sources_used: u32,
    pub total_sources: u32,
    pub confidence_score: u32,
    pub timestamp: u64,
}
