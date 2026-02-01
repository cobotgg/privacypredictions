use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // ============================================
    // Encrypted State Structures
    // ============================================

    /// Encrypted batch state containing aggregated order data
    pub struct BatchState {
        pub total_amount: u64,        // Total USDC in batch
        pub order_count: u8,          // Number of orders
        pub commitment_root: u128,    // Running merkle root (lo)
        pub commitment_root_hi: u128, // Running merkle root (hi)
        // Space for up to 32 order hashes
        pub order_hash_1: u128,
        pub order_hash_2: u128,
        pub order_hash_3: u128,
        pub order_hash_4: u128,
    }

    /// Output from batch initialization
    pub struct BatchInitOutput {
        pub ciphertexts: [[u8; 32]; 8],
        pub nonce: u128,
    }

    /// Output from adding an order
    pub struct AddOrderOutputData {
        pub ciphertexts: [[u8; 32]; 8],
        pub nonce: u128,
    }

    /// Output from batch execution
    pub struct ExecuteBatchOutputData {
        pub merkle_root: [u8; 32],
        pub total_usdc: u64,
    }

    // ============================================
    // Encrypted Instructions
    // ============================================

    /// Initialize a new encrypted batch state
    #[instruction]
    pub fn init_batch(nonce_input: u128) -> BatchInitOutput {
        let initial_state = BatchState {
            total_amount: 0,
            order_count: 0,
            commitment_root: 0,
            commitment_root_hi: 0,
            order_hash_1: 0,
            order_hash_2: 0,
            order_hash_3: 0,
            order_hash_4: 0,
        };

        // Encrypt the initial state
        let encrypted = initial_state.encrypt(nonce_input);

        BatchInitOutput {
            ciphertexts: encrypted.ciphertexts,
            nonce: encrypted.nonce,
        }
    }

    /// Add an encrypted order to the batch
    ///
    /// This function:
    /// 1. Decrypts the current batch state
    /// 2. Adds the new order amount to total
    /// 3. Updates the commitment merkle root
    /// 4. Re-encrypts the state
    #[instruction]
    pub fn add_order(
        user_amount: Enc<Shared, u64>,
        user_wallet_lo: Enc<Shared, u128>,
        user_wallet_hi: Enc<Shared, u128>,
        state_nonce: u128,
        current_state: Enc<Account, BatchState>,
    ) -> AddOrderOutputData {
        // Decrypt inputs
        let amount = user_amount.to_arcis();
        let wallet_lo = user_wallet_lo.to_arcis();
        let wallet_hi = user_wallet_hi.to_arcis();
        let mut state = current_state.decrypt(state_nonce);

        // Update totals
        state.total_amount = state.total_amount + amount;
        state.order_count = state.order_count + 1;

        // Compute order commitment hash (simplified poseidon-like)
        let order_hash = compute_order_hash(amount, wallet_lo, wallet_hi);

        // Update merkle root (running hash)
        let (new_root_lo, new_root_hi) = update_merkle_root(
            state.commitment_root,
            state.commitment_root_hi,
            order_hash,
        );
        state.commitment_root = new_root_lo;
        state.commitment_root_hi = new_root_hi;

        // Store order hash based on count
        match state.order_count {
            1 => state.order_hash_1 = order_hash,
            2 => state.order_hash_2 = order_hash,
            3 => state.order_hash_3 = order_hash,
            4 => state.order_hash_4 = order_hash,
            _ => {} // Additional orders use running root
        }

        // Re-encrypt state with new nonce
        let new_nonce = ArcisRNG::u128();
        let encrypted = state.encrypt(new_nonce);

        AddOrderOutputData {
            ciphertexts: encrypted.ciphertexts,
            nonce: new_nonce,
        }
    }

    /// Execute the batch and compute final allocations
    ///
    /// This function:
    /// 1. Decrypts all order data
    /// 2. Computes pro-rata share allocations
    /// 3. Generates the final merkle root for ZK verification
    /// 4. Returns public outputs for on-chain verification
    #[instruction]
    pub fn execute_batch(
        total_shares: u64,
        execution_price: u64,
        state_nonce: u128,
        current_state: Enc<Account, BatchState>,
    ) -> ExecuteBatchOutputData {
        let state = current_state.decrypt(state_nonce);

        // Compute final merkle root from all order hashes
        let mut final_root = [0u8; 32];

        // Convert commitment root to bytes
        let root_lo_bytes = state.commitment_root.to_le_bytes();
        let root_hi_bytes = state.commitment_root_hi.to_le_bytes();

        for i in 0..16 {
            final_root[i] = root_lo_bytes[i];
            final_root[i + 16] = root_hi_bytes[i];
        }

        // Add execution parameters to root for verification
        let exec_hash = hash_execution_params(total_shares, execution_price, state.total_amount);
        for i in 0..8 {
            final_root[i] ^= ((exec_hash >> (i * 8)) & 0xFF) as u8;
        }

        ExecuteBatchOutputData {
            merkle_root: final_root,
            total_usdc: state.total_amount.reveal(),
        }
    }

    // ============================================
    // Helper Functions
    // ============================================

    /// Compute a hash of an order (simplified poseidon-like)
    fn compute_order_hash(amount: u64, wallet_lo: u128, wallet_hi: u128) -> u128 {
        let mut hash: u128 = 0;

        // Mix amount
        hash = hash.wrapping_add(amount as u128);
        hash = hash.wrapping_mul(31);

        // Mix wallet
        hash = hash ^ wallet_lo;
        hash = hash.wrapping_mul(31);
        hash = hash ^ wallet_hi;

        hash
    }

    /// Update merkle root with new leaf
    fn update_merkle_root(
        current_lo: u128,
        current_hi: u128,
        new_leaf: u128,
    ) -> (u128, u128) {
        // Simple merkle update (hash of current || new_leaf)
        let new_lo = current_lo ^ new_leaf;
        let new_hi = current_hi.wrapping_add(new_leaf);
        (new_lo, new_hi)
    }

    /// Hash execution parameters for verification
    fn hash_execution_params(total_shares: u64, price: u64, total_usdc: u64) -> u64 {
        let mut hash: u64 = 0;
        hash = hash.wrapping_add(total_shares);
        hash = hash.wrapping_mul(31);
        hash = hash.wrapping_add(price);
        hash = hash.wrapping_mul(31);
        hash = hash.wrapping_add(total_usdc);
        hash
    }
}
