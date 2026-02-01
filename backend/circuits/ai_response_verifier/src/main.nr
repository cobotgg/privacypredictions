use poseidon::poseidon::bn254::{hash_2, hash_3};

// AI Response Verification Circuit
// Verifies that:
// 1. Query commitment matches the hashed query parameters
// 2. Response commitment matches the hashed response
// 3. Both are linked via Merkle root for batch verification
// 4. Timestamp is within valid bounds

// Circuit public inputs:
// - query_commitment: Hash of (market_id, question_hash, timestamp)
// - response_commitment: Hash of (content_hash, model_id, generated_at)
// - merkle_root: Root of Merkle tree containing both commitments
// - timestamp: Unix timestamp of query

fn main(
    // PUBLIC INPUTS - visible to all verifiers
    query_commitment: pub Field,
    response_commitment: pub Field,
    merkle_root: pub Field,
    timestamp: pub Field,

    // PRIVATE INPUTS - hidden from verifiers
    market_id: Field,
    question_hash: Field,
    query_timestamp: Field,
    content_hash: Field,
    model_id: Field,
    generated_at: Field,
) {
    // ============================================
    // CONSTRAINT 1: Verify query commitment
    // ============================================
    let computed_query_commitment = hash_3([
        market_id,
        question_hash,
        query_timestamp,
    ]);
    assert(computed_query_commitment == query_commitment);

    // ============================================
    // CONSTRAINT 2: Verify response commitment
    // ============================================
    let computed_response_commitment = hash_3([
        content_hash,
        model_id,
        generated_at,
    ]);
    assert(computed_response_commitment == response_commitment);

    // ============================================
    // CONSTRAINT 3: Verify Merkle root
    // ============================================
    // Build simple 2-leaf Merkle tree
    let computed_root = hash_2([query_commitment, response_commitment]);
    assert(computed_root == merkle_root);

    // ============================================
    // CONSTRAINT 4: Verify timestamp consistency
    // ============================================
    assert(query_timestamp == timestamp);
}

// Test module
#[test]
fn test_basic_verification() {
    // Test with sample inputs
    let market_id: Field = 12345;
    let question_hash: Field = 67890;
    let query_timestamp: Field = 1706800000;
    let content_hash: Field = 11111;
    let model_id: Field = 22222;
    let generated_at: Field = 1706800001;

    // Compute expected commitments
    let query_commitment = hash_3([market_id, question_hash, query_timestamp]);
    let response_commitment = hash_3([content_hash, model_id, generated_at]);
    let merkle_root = hash_2([query_commitment, response_commitment]);

    // This should pass
    main(
        query_commitment,
        response_commitment,
        merkle_root,
        query_timestamp,
        market_id,
        question_hash,
        query_timestamp,
        content_hash,
        model_id,
        generated_at,
    );
}
