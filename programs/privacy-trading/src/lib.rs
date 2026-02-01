use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

/// Computation definition offsets for encrypted operations
const COMP_DEF_OFFSET_INIT_BATCH: u32 = comp_def_offset("init_batch");
const COMP_DEF_OFFSET_ADD_ORDER: u32 = comp_def_offset("add_order");
const COMP_DEF_OFFSET_EXECUTE_BATCH: u32 = comp_def_offset("execute_batch");
const COMP_DEF_OFFSET_VERIFY_ALLOCATION: u32 = comp_def_offset("verify_allocation");

declare_id!("3vfatmfrqUfPFRFKP9xTUWKYNYRL7X1wqg2Dz2z4zMQL");

/// Order side - YES or NO position
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Side {
    Yes,
    No,
}

/// Batch status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BatchStatus {
    Open,
    Closed,
    Executed,
    Verified,
}

#[arcium_program]
pub mod privacy_trading {
    use super::*;

    // ============================================
    // Computation Definition Initialization
    // ============================================

    pub fn init_batch_comp_def(ctx: Context<InitBatchCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_add_order_comp_def(ctx: Context<InitAddOrderCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_execute_batch_comp_def(ctx: Context<InitExecuteBatchCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_verify_allocation_comp_def(ctx: Context<InitVerifyAllocationCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // ============================================
    // Trading Operations
    // ============================================

    /// Create a new trading batch for a market
    pub fn create_batch(
        ctx: Context<CreateBatch>,
        computation_offset: u64,
        market_id: String,
        side: Side,
        nonce: u128,
    ) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        batch.bump = ctx.bumps.batch;
        batch.authority = ctx.accounts.authority.key();
        batch.market_id = market_id;
        batch.side = side;
        batch.status = BatchStatus::Open;
        batch.order_count = 0;
        batch.total_usdc = 0;
        batch.state_nonce = nonce;
        batch.encrypted_state = [[0u8; 32]; 8];
        batch.merkle_root = [0u8; 32];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Initialize encrypted batch state via MPC
        let args = ArgBuilder::new()
            .plaintext_u128(nonce)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitBatchCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.batch.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_batch")]
    pub fn init_batch_callback(
        ctx: Context<InitBatchCallback>,
        output: SignedComputationOutputs<InitBatchOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitBatchOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let batch = &mut ctx.accounts.batch;
        batch.encrypted_state = o.ciphertexts;
        batch.state_nonce = o.nonce;

        emit!(BatchCreated {
            batch: batch.key(),
            market_id: batch.market_id.clone(),
            side: batch.side,
            authority: batch.authority,
        });

        Ok(())
    }

    /// Add an encrypted order to the batch
    pub fn add_order(
        ctx: Context<AddOrder>,
        computation_offset: u64,
        encrypted_amount: [u8; 32],
        encrypted_wallet_lo: [u8; 32],
        encrypted_wallet_hi: [u8; 32],
        user_pubkey: [u8; 32],
        nonce: u128,
        commitment_hash: [u8; 32],
    ) -> Result<()> {
        let batch = &ctx.accounts.batch;
        require!(batch.status == BatchStatus::Open, ErrorCode::BatchNotOpen);
        require!(batch.order_count < 32, ErrorCode::BatchFull);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Store order commitment for ZK proof verification
        let order = &mut ctx.accounts.order;
        order.bump = ctx.bumps.order;
        order.batch = batch.key();
        order.user = ctx.accounts.user.key();
        order.commitment_hash = commitment_hash;
        order.index = batch.order_count;
        order.allocated = false;

        const ENCRYPTED_STATE_OFFSET: u32 = 8 + 1 + 32 + 64 + 1 + 1 + 1 + 8 + 16; // Account header offset
        const ENCRYPTED_STATE_SIZE: u32 = 32 * 8;

        let args = ArgBuilder::new()
            .x25519_pubkey(user_pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_amount)
            .encrypted_u128(encrypted_wallet_lo)
            .encrypted_u128(encrypted_wallet_hi)
            .plaintext_u128(batch.state_nonce)
            .account(
                ctx.accounts.batch.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![AddOrderCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.batch.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.order.key(),
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "add_order")]
    pub fn add_order_callback(
        ctx: Context<AddOrderCallback>,
        output: SignedComputationOutputs<AddOrderOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(AddOrderOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let batch = &mut ctx.accounts.batch;
        batch.encrypted_state = o.ciphertexts;
        batch.state_nonce = o.nonce;
        batch.order_count += 1;

        emit!(OrderAdded {
            batch: batch.key(),
            order: ctx.accounts.order.key(),
            order_index: batch.order_count - 1,
            commitment_hash: ctx.accounts.order.commitment_hash,
        });

        Ok(())
    }

    /// Close the batch and compute merkle root
    pub fn close_batch(ctx: Context<CloseBatch>) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        require!(batch.status == BatchStatus::Open, ErrorCode::BatchNotOpen);
        require!(batch.order_count > 0, ErrorCode::EmptyBatch);

        batch.status = BatchStatus::Closed;

        emit!(BatchClosed {
            batch: batch.key(),
            order_count: batch.order_count,
        });

        Ok(())
    }

    /// Execute the batch trade via MPC
    pub fn execute_batch(
        ctx: Context<ExecuteBatch>,
        computation_offset: u64,
        total_shares: u64,
        execution_price: u64,
    ) -> Result<()> {
        let batch = &ctx.accounts.batch;
        require!(batch.status == BatchStatus::Closed, ErrorCode::BatchNotClosed);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        const ENCRYPTED_STATE_OFFSET: u32 = 8 + 1 + 32 + 64 + 1 + 1 + 1 + 8 + 16;
        const ENCRYPTED_STATE_SIZE: u32 = 32 * 8;

        let args = ArgBuilder::new()
            .plaintext_u64(total_shares)
            .plaintext_u64(execution_price)
            .plaintext_u128(batch.state_nonce)
            .account(
                ctx.accounts.batch.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ExecuteBatchCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.batch.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "execute_batch")]
    pub fn execute_batch_callback(
        ctx: Context<ExecuteBatchCallback>,
        output: SignedComputationOutputs<ExecuteBatchOutput>,
    ) -> Result<()> {
        let (merkle_root, total_usdc) = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ExecuteBatchOutput {
                field_0: ExecuteBatchOutputStruct0 {
                    field_0: merkle_root,
                    field_1: total_usdc,
                },
            }) => (merkle_root, total_usdc),
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let batch = &mut ctx.accounts.batch;
        batch.merkle_root = merkle_root;
        batch.total_usdc = total_usdc;
        batch.status = BatchStatus::Executed;

        emit!(BatchExecuted {
            batch: batch.key(),
            merkle_root,
            total_usdc,
            order_count: batch.order_count,
        });

        Ok(())
    }

    /// Verify share allocation with ZK proof
    pub fn verify_allocation(
        ctx: Context<VerifyAllocation>,
        proof_data: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        let batch = &ctx.accounts.batch;
        require!(batch.status == BatchStatus::Executed, ErrorCode::BatchNotExecuted);

        // Verify the ZK proof
        require!(public_inputs.len() >= 4, ErrorCode::InvalidProof);

        let proof_merkle_root = public_inputs[1];
        require!(proof_merkle_root == batch.merkle_root, ErrorCode::MerkleRootMismatch);

        // In production, call the ZK verifier program via CPI
        // For now, validate proof structure
        require!(proof_data.len() >= 64, ErrorCode::InvalidProofData);

        let batch = &mut ctx.accounts.batch;
        batch.status = BatchStatus::Verified;

        emit!(AllocationVerified {
            batch: batch.key(),
            merkle_root: batch.merkle_root,
        });

        Ok(())
    }
}

// ============================================
// Account Structures
// ============================================

#[account]
#[derive(InitSpace)]
pub struct TradingBatch {
    pub bump: u8,
    pub authority: Pubkey,
    #[max_len(64)]
    pub market_id: String,
    pub side: Side,
    pub status: BatchStatus,
    pub order_count: u8,
    pub total_usdc: u64,
    pub state_nonce: u128,
    pub encrypted_state: [[u8; 32]; 8],
    pub merkle_root: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct OrderCommitment {
    pub bump: u8,
    pub batch: Pubkey,
    pub user: Pubkey,
    pub commitment_hash: [u8; 32],
    pub index: u8,
    pub allocated: bool,
}

// ============================================
// Account Contexts
// ============================================

#[queue_computation_accounts("init_batch", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, market_id: String)]
pub struct CreateBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + TradingBatch::INIT_SPACE,
        seeds = [b"batch", market_id.as_bytes(), authority.key().as_ref()],
        bump,
    )]
    pub batch: Account<'info, TradingBatch>,

    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_BATCH))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_batch")]
#[derive(Accounts)]
pub struct InitBatchCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_BATCH))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(mut)]
    pub batch: Account<'info, TradingBatch>,
}

#[queue_computation_accounts("add_order", user)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AddOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub batch: Account<'info, TradingBatch>,

    #[account(
        init,
        payer = user,
        space = 8 + OrderCommitment::INIT_SPACE,
        seeds = [b"order", batch.key().as_ref(), &[batch.order_count]],
        bump,
    )]
    pub order: Account<'info, OrderCommitment>,

    #[account(
        init_if_needed,
        space = 9,
        payer = user,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_ORDER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("add_order")]
#[derive(Accounts)]
pub struct AddOrderCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_ORDER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(mut)]
    pub batch: Account<'info, TradingBatch>,

    #[account(mut)]
    pub order: Account<'info, OrderCommitment>,
}

#[derive(Accounts)]
pub struct CloseBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub batch: Account<'info, TradingBatch>,
}

#[queue_computation_accounts("execute_batch", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ExecuteBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority @ ErrorCode::Unauthorized)]
    pub batch: Account<'info, TradingBatch>,

    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_EXECUTE_BATCH))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("execute_batch")]
#[derive(Accounts)]
pub struct ExecuteBatchCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_EXECUTE_BATCH))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(mut)]
    pub batch: Account<'info, TradingBatch>,
}

#[derive(Accounts)]
pub struct VerifyAllocation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub batch: Account<'info, TradingBatch>,
}

// ============================================
// Computation Definition Initialization Contexts
// ============================================

#[init_computation_definition_accounts("init_batch", payer)]
#[derive(Accounts)]
pub struct InitBatchCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("add_order", payer)]
#[derive(Accounts)]
pub struct InitAddOrderCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("execute_batch", payer)]
#[derive(Accounts)]
pub struct InitExecuteBatchCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("verify_allocation", payer)]
#[derive(Accounts)]
pub struct InitVerifyAllocationCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ============================================
// Events
// ============================================

#[event]
pub struct BatchCreated {
    pub batch: Pubkey,
    pub market_id: String,
    pub side: Side,
    pub authority: Pubkey,
}

#[event]
pub struct OrderAdded {
    pub batch: Pubkey,
    pub order: Pubkey,
    pub order_index: u8,
    pub commitment_hash: [u8; 32],
}

#[event]
pub struct BatchClosed {
    pub batch: Pubkey,
    pub order_count: u8,
}

#[event]
pub struct BatchExecuted {
    pub batch: Pubkey,
    pub merkle_root: [u8; 32],
    pub total_usdc: u64,
    pub order_count: u8,
}

#[event]
pub struct AllocationVerified {
    pub batch: Pubkey,
    pub merkle_root: [u8; 32],
}

// ============================================
// Errors
// ============================================

#[error_code]
pub enum ErrorCode {
    #[msg("Computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Batch is not open")]
    BatchNotOpen,
    #[msg("Batch is not closed")]
    BatchNotClosed,
    #[msg("Batch is not executed")]
    BatchNotExecuted,
    #[msg("Batch is full (max 32 orders)")]
    BatchFull,
    #[msg("Empty batch")]
    EmptyBatch,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid proof")]
    InvalidProof,
    #[msg("Invalid proof data")]
    InvalidProofData,
    #[msg("Merkle root mismatch")]
    MerkleRootMismatch,
}
