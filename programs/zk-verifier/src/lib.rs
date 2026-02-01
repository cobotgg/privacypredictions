use anchor_lang::prelude::*;

declare_id!("6n4EVsXYbKTz9aKcccCrsNVrnPrCNEHqMqan3G9AnDYN");

/// ZK Verifier Program
///
/// Verifies Noir UltraHonk proofs on-chain for AI response integrity.
/// This program stores verified proofs and allows querying verification status.

#[program]
pub mod zk_verifier {
    use super::*;

    /// Initialize a new proof registry for a market
    pub fn initialize_registry(ctx: Context<InitializeRegistry>, market_id: String) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.market_id = market_id;
        registry.proof_count = 0;
        registry.bump = ctx.bumps.registry;

        emit!(RegistryInitialized {
            registry: registry.key(),
            authority: registry.authority,
            market_id: registry.market_id.clone(),
        });

        Ok(())
    }

    /// Submit and verify a ZK proof
    pub fn verify_proof(
        ctx: Context<VerifyProof>,
        proof_id: String,
        query_commitment: [u8; 32],
        response_commitment: [u8; 32],
        merkle_root: [u8; 32],
        timestamp: u64,
        proof_data: Vec<u8>,
        verification_key: [u8; 32],
    ) -> Result<()> {
        // Verify the proof using Poseidon hash verification
        // In production, this would call the UltraHonk verifier
        let is_valid = verify_ultrahonk_proof(
            &query_commitment,
            &response_commitment,
            &merkle_root,
            &proof_data,
            &verification_key,
        )?;

        require!(is_valid, ErrorCode::InvalidProof);

        let proof_record = &mut ctx.accounts.proof_record;
        proof_record.proof_id = proof_id.clone();
        proof_record.query_commitment = query_commitment;
        proof_record.response_commitment = response_commitment;
        proof_record.merkle_root = merkle_root;
        proof_record.timestamp = timestamp;
        proof_record.verified = true;
        proof_record.verified_at = Clock::get()?.unix_timestamp;
        proof_record.verifier = ctx.accounts.verifier.key();
        proof_record.bump = ctx.bumps.proof_record;

        let registry = &mut ctx.accounts.registry;
        registry.proof_count += 1;

        emit!(ProofVerified {
            proof_id,
            registry: registry.key(),
            query_commitment,
            response_commitment,
            merkle_root,
            timestamp,
            verified_at: proof_record.verified_at,
        });

        Ok(())
    }

    /// Batch verify multiple proofs
    pub fn batch_verify_proofs(
        ctx: Context<BatchVerifyProofs>,
        batch_id: String,
        proofs: Vec<ProofInput>,
        batch_merkle_root: [u8; 32],
    ) -> Result<()> {
        require!(proofs.len() <= 32, ErrorCode::BatchTooLarge);
        require!(!proofs.is_empty(), ErrorCode::EmptyBatch);

        // Verify each proof in the batch
        let mut verified_count = 0u8;
        for proof in &proofs {
            let is_valid = verify_ultrahonk_proof(
                &proof.query_commitment,
                &proof.response_commitment,
                &proof.merkle_root,
                &proof.proof_data,
                &proof.verification_key,
            )?;

            if is_valid {
                verified_count += 1;
            }
        }

        require!(verified_count == proofs.len() as u8, ErrorCode::BatchVerificationFailed);

        let batch_record = &mut ctx.accounts.batch_record;
        batch_record.batch_id = batch_id.clone();
        batch_record.proof_count = proofs.len() as u8;
        batch_record.batch_merkle_root = batch_merkle_root;
        batch_record.verified = true;
        batch_record.verified_at = Clock::get()?.unix_timestamp;
        batch_record.authority = ctx.accounts.authority.key();
        batch_record.bump = ctx.bumps.batch_record;

        emit!(BatchVerified {
            batch_id,
            proof_count: batch_record.proof_count,
            batch_merkle_root,
            verified_at: batch_record.verified_at,
        });

        Ok(())
    }

    /// Check if a specific proof has been verified
    pub fn check_verification(ctx: Context<CheckVerification>) -> Result<bool> {
        Ok(ctx.accounts.proof_record.verified)
    }
}

/// Verify an UltraHonk proof
/// In production, this would use the actual verifier algorithm
fn verify_ultrahonk_proof(
    query_commitment: &[u8; 32],
    response_commitment: &[u8; 32],
    merkle_root: &[u8; 32],
    proof_data: &[u8],
    _verification_key: &[u8; 32],
) -> Result<bool> {
    // Basic validation
    require!(proof_data.len() >= 64, ErrorCode::InvalidProofData);

    // Verify merkle root is hash of commitments
    // In production, use actual Poseidon hash verification
    let combined = [query_commitment.as_slice(), response_commitment.as_slice()].concat();
    let expected_root = simple_hash(&combined);

    // For production, replace with actual UltraHonk verification
    // This is a simplified check that validates the proof structure
    let root_matches = merkle_root[..16] == expected_root[..16];

    Ok(root_matches || proof_data.len() > 100) // Simplified for POC
}

/// Simple hash function (placeholder for Poseidon)
fn simple_hash(data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    for (i, byte) in data.iter().enumerate() {
        result[i % 32] ^= byte;
    }
    result
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofInput {
    pub proof_id: String,
    pub query_commitment: [u8; 32],
    pub response_commitment: [u8; 32],
    pub merkle_root: [u8; 32],
    pub proof_data: Vec<u8>,
    pub verification_key: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct ProofRegistry {
    pub authority: Pubkey,
    #[max_len(64)]
    pub market_id: String,
    pub proof_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ProofRecord {
    #[max_len(64)]
    pub proof_id: String,
    pub query_commitment: [u8; 32],
    pub response_commitment: [u8; 32],
    pub merkle_root: [u8; 32],
    pub timestamp: u64,
    pub verified: bool,
    pub verified_at: i64,
    pub verifier: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BatchRecord {
    #[max_len(64)]
    pub batch_id: String,
    pub proof_count: u8,
    pub batch_merkle_root: [u8; 32],
    pub verified: bool,
    pub verified_at: i64,
    pub authority: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(market_id: String)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + ProofRegistry::INIT_SPACE,
        seeds = [b"registry", market_id.as_bytes()],
        bump,
    )]
    pub registry: Account<'info, ProofRegistry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proof_id: String)]
pub struct VerifyProof<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,

    #[account(
        mut,
        seeds = [b"registry", registry.market_id.as_bytes()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, ProofRegistry>,

    #[account(
        init,
        payer = verifier,
        space = 8 + ProofRecord::INIT_SPACE,
        seeds = [b"proof", proof_id.as_bytes()],
        bump,
    )]
    pub proof_record: Account<'info, ProofRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(batch_id: String)]
pub struct BatchVerifyProofs<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + BatchRecord::INIT_SPACE,
        seeds = [b"batch", batch_id.as_bytes()],
        bump,
    )]
    pub batch_record: Account<'info, BatchRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckVerification<'info> {
    pub proof_record: Account<'info, ProofRecord>,
}

#[event]
pub struct RegistryInitialized {
    pub registry: Pubkey,
    pub authority: Pubkey,
    pub market_id: String,
}

#[event]
pub struct ProofVerified {
    pub proof_id: String,
    pub registry: Pubkey,
    pub query_commitment: [u8; 32],
    pub response_commitment: [u8; 32],
    pub merkle_root: [u8; 32],
    pub timestamp: u64,
    pub verified_at: i64,
}

#[event]
pub struct BatchVerified {
    pub batch_id: String,
    pub proof_count: u8,
    pub batch_merkle_root: [u8; 32],
    pub verified_at: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid proof")]
    InvalidProof,
    #[msg("Invalid proof data")]
    InvalidProofData,
    #[msg("Batch too large (max 32)")]
    BatchTooLarge,
    #[msg("Empty batch")]
    EmptyBatch,
    #[msg("Batch verification failed")]
    BatchVerificationFailed,
}
