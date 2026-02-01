pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";

/**
 * AI Response Verification Circuit (Groth16)
 *
 * Verifies that:
 * 1. Query commitment matches Poseidon(market_id, question_hash, timestamp)
 * 2. Response commitment matches Poseidon(content_hash, model_id, generated_at)
 * 3. Merkle root matches Poseidon(query_commitment, response_commitment)
 * 4. Timestamp is consistent
 *
 * Public Inputs (4):
 *   - query_commitment
 *   - response_commitment
 *   - merkle_root
 *   - timestamp
 *
 * Private Inputs (6):
 *   - market_id
 *   - question_hash
 *   - query_timestamp
 *   - content_hash
 *   - model_id
 *   - generated_at
 */
template AIResponseVerifier() {
    // Public inputs
    signal input query_commitment;
    signal input response_commitment;
    signal input merkle_root;
    signal input timestamp;

    // Private inputs
    signal input market_id;
    signal input question_hash;
    signal input query_timestamp;
    signal input content_hash;
    signal input model_id;
    signal input generated_at;

    // ============================================
    // CONSTRAINT 1: Verify query commitment
    // ============================================
    component queryHasher = Poseidon(3);
    queryHasher.inputs[0] <== market_id;
    queryHasher.inputs[1] <== question_hash;
    queryHasher.inputs[2] <== query_timestamp;

    // Constrain: computed query commitment must equal public input
    query_commitment === queryHasher.out;

    // ============================================
    // CONSTRAINT 2: Verify response commitment
    // ============================================
    component responseHasher = Poseidon(3);
    responseHasher.inputs[0] <== content_hash;
    responseHasher.inputs[1] <== model_id;
    responseHasher.inputs[2] <== generated_at;

    // Constrain: computed response commitment must equal public input
    response_commitment === responseHasher.out;

    // ============================================
    // CONSTRAINT 3: Verify merkle root
    // ============================================
    component merkleHasher = Poseidon(2);
    merkleHasher.inputs[0] <== query_commitment;
    merkleHasher.inputs[1] <== response_commitment;

    // Constrain: computed merkle root must equal public input
    merkle_root === merkleHasher.out;

    // ============================================
    // CONSTRAINT 4: Verify timestamp consistency
    // ============================================
    timestamp === query_timestamp;
}

component main {public [query_commitment, response_commitment, merkle_root, timestamp]} = AIResponseVerifier();
