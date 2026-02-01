import { Connection, Commitment } from '@solana/web3.js';
import { config } from '../config/env.js';

/**
 * RPC Provider Configuration
 */
interface RPCEndpoint {
  name: string;
  url: string;
  priority: number; // Lower = higher priority (1 = primary)
  weight: number;   // For load balancing (higher = more traffic)
  healthy: boolean;
  lastHealthCheck: number;
  consecutiveFailures: number;
  avgResponseTime: number;
  totalRequests: number;
  failedRequests: number;
}

interface RPCProviderConfig {
  healthCheckInterval: number;     // ms between health checks
  failureThreshold: number;        // consecutive failures before marking unhealthy
  recoveryThreshold: number;       // successful checks before marking healthy again
  requestTimeout: number;          // ms timeout for RPC requests
  maxRetries: number;              // max retries per request
  retryDelay: number;              // ms delay between retries
}

const DEFAULT_CONFIG: RPCProviderConfig = {
  healthCheckInterval: 30000,      // 30 seconds
  failureThreshold: 3,             // 3 consecutive failures
  recoveryThreshold: 2,            // 2 successful checks to recover
  requestTimeout: 30000,           // 30 second timeout
  maxRetries: 3,                   // 3 retries
  retryDelay: 1000,                // 1 second between retries
};

/**
 * Robust RPC Provider with automatic failover and load balancing
 *
 * Features:
 * - Multiple RPC endpoints with priority ordering
 * - Automatic failover when primary fails
 * - Health checks to detect and recover from failures
 * - Request metrics tracking
 * - Weighted load balancing (optional)
 */
class RPCProvider {
  private endpoints: RPCEndpoint[] = [];
  private connections: Map<string, Connection> = new Map();
  private config: RPCProviderConfig;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private currentEndpointIndex: number = 0;
  private commitment: Commitment = 'confirmed';

  constructor(customConfig?: Partial<RPCProviderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.initializeEndpoints();
    this.startHealthChecks();
  }

  /**
   * Initialize RPC endpoints from environment variables
   * Priority order: Helius (1) > QuickNode (2) > Alchemy (3) > Default (4)
   */
  private initializeEndpoints(): void {
    const endpointConfigs: { name: string; url: string | undefined; priority: number; weight: number }[] = [
      { name: 'Helius', url: config.heliusRpcUrl, priority: 1, weight: 50 },
      { name: 'QuickNode', url: config.quicknodeRpcUrl, priority: 2, weight: 30 },
      { name: 'Alchemy', url: config.alchemyRpcUrl, priority: 3, weight: 20 },
      { name: 'Default', url: config.solanaRpcUrl, priority: 4, weight: 10 },
    ];

    for (const ec of endpointConfigs) {
      if (ec.url && ec.url.trim() && !ec.url.includes('your_')) {
        const endpoint: RPCEndpoint = {
          name: ec.name,
          url: ec.url,
          priority: ec.priority,
          weight: ec.weight,
          healthy: true, // Assume healthy initially
          lastHealthCheck: Date.now(),
          consecutiveFailures: 0,
          avgResponseTime: 0,
          totalRequests: 0,
          failedRequests: 0,
        };

        this.endpoints.push(endpoint);

        // Create connection for this endpoint
        const connection = new Connection(ec.url, {
          commitment: this.commitment,
          confirmTransactionInitialTimeout: this.config.requestTimeout,
        });
        this.connections.set(ec.name, connection);

        console.log(`[RPC] Registered endpoint: ${ec.name} (priority: ${ec.priority})`);
      }
    }

    // Sort by priority (lower number = higher priority)
    this.endpoints.sort((a, b) => a.priority - b.priority);

    if (this.endpoints.length === 0) {
      throw new Error('[RPC] No valid RPC endpoints configured!');
    }

    console.log(`[RPC] Initialized with ${this.endpoints.length} endpoints`);
    console.log(`[RPC] Primary endpoint: ${this.endpoints[0].name}`);
  }

  /**
   * Get the best available connection (respects priority and health)
   */
  getConnection(): Connection {
    // Find first healthy endpoint by priority
    const healthyEndpoint = this.endpoints.find(e => e.healthy);

    if (healthyEndpoint) {
      const conn = this.connections.get(healthyEndpoint.name);
      if (conn) return conn;
    }

    // All endpoints unhealthy - try the primary anyway
    console.warn('[RPC] All endpoints unhealthy, using primary endpoint');
    const primaryConn = this.connections.get(this.endpoints[0].name);
    if (primaryConn) return primaryConn;

    throw new Error('[RPC] No connections available');
  }

  /**
   * Get a specific connection by provider name
   */
  getConnectionByName(name: string): Connection | undefined {
    return this.connections.get(name);
  }

  /**
   * Execute an RPC call with automatic failover
   */
  async executeWithFailover<T>(
    operation: (connection: Connection) => Promise<T>,
    operationName: string = 'RPC call'
  ): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    // Try each healthy endpoint in priority order
    for (const endpoint of this.endpoints) {
      if (!endpoint.healthy && this.getHealthyEndpointCount() > 0) {
        continue; // Skip unhealthy endpoints if we have healthy ones
      }

      const connection = this.connections.get(endpoint.name);
      if (!connection) continue;

      for (let retry = 0; retry < this.config.maxRetries; retry++) {
        try {
          endpoint.totalRequests++;
          const result = await this.withTimeout(
            operation(connection),
            this.config.requestTimeout
          );

          // Success - update metrics
          const responseTime = Date.now() - startTime;
          this.updateEndpointMetrics(endpoint, true, responseTime);

          if (retry > 0 || endpoint !== this.endpoints[0]) {
            console.log(`[RPC] ${operationName} succeeded via ${endpoint.name} (retry: ${retry})`);
          }

          return result;
        } catch (error: any) {
          lastError = error;
          endpoint.failedRequests++;

          const isRateLimitError = error.message?.includes('429') ||
                                    error.message?.includes('rate limit') ||
                                    error.message?.includes('Too Many Requests');

          const isConnectionError = error.message?.includes('ECONNREFUSED') ||
                                     error.message?.includes('ETIMEDOUT') ||
                                     error.message?.includes('ENOTFOUND') ||
                                     error.message?.includes('fetch failed');

          console.warn(`[RPC] ${operationName} failed on ${endpoint.name} (retry ${retry + 1}/${this.config.maxRetries}): ${error.message?.substring(0, 100)}`);

          // If rate limited or connection error, try next endpoint immediately
          if (isRateLimitError || isConnectionError) {
            this.updateEndpointMetrics(endpoint, false, 0);
            break; // Move to next endpoint
          }

          // Wait before retry on same endpoint
          if (retry < this.config.maxRetries - 1) {
            await this.sleep(this.config.retryDelay * (retry + 1));
          }
        }
      }

      // All retries failed on this endpoint
      this.updateEndpointMetrics(endpoint, false, 0);
    }

    // All endpoints failed
    throw lastError || new Error(`[RPC] ${operationName} failed on all endpoints`);
  }

  /**
   * Health check a single endpoint
   */
  private async checkEndpointHealth(endpoint: RPCEndpoint): Promise<boolean> {
    const connection = this.connections.get(endpoint.name);
    if (!connection) return false;

    try {
      const startTime = Date.now();
      await this.withTimeout(connection.getSlot(), 5000); // 5 second timeout for health check
      const responseTime = Date.now() - startTime;

      endpoint.avgResponseTime = endpoint.avgResponseTime === 0
        ? responseTime
        : (endpoint.avgResponseTime * 0.8 + responseTime * 0.2); // Exponential moving average

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update endpoint metrics based on request result
   */
  private updateEndpointMetrics(endpoint: RPCEndpoint, success: boolean, responseTime: number): void {
    if (success) {
      endpoint.consecutiveFailures = 0;

      if (!endpoint.healthy) {
        // Check if we should mark as healthy again
        endpoint.healthy = true;
        console.log(`[RPC] ${endpoint.name} recovered and marked healthy`);
      }

      if (responseTime > 0) {
        endpoint.avgResponseTime = endpoint.avgResponseTime === 0
          ? responseTime
          : (endpoint.avgResponseTime * 0.8 + responseTime * 0.2);
      }
    } else {
      endpoint.consecutiveFailures++;

      if (endpoint.consecutiveFailures >= this.config.failureThreshold && endpoint.healthy) {
        endpoint.healthy = false;
        console.warn(`[RPC] ${endpoint.name} marked UNHEALTHY after ${endpoint.consecutiveFailures} consecutive failures`);

        // Log which endpoint we'll fail over to
        const nextHealthy = this.endpoints.find(e => e.healthy && e !== endpoint);
        if (nextHealthy) {
          console.log(`[RPC] Failing over to ${nextHealthy.name}`);
        }
      }
    }
  }

  /**
   * Run health checks on all endpoints
   */
  private async runHealthChecks(): Promise<void> {
    for (const endpoint of this.endpoints) {
      const healthy = await this.checkEndpointHealth(endpoint);
      endpoint.lastHealthCheck = Date.now();

      if (healthy && !endpoint.healthy) {
        // Endpoint recovered
        endpoint.consecutiveFailures = 0;
        endpoint.healthy = true;
        console.log(`[RPC] ${endpoint.name} recovered (health check passed)`);
      } else if (!healthy && endpoint.healthy) {
        endpoint.consecutiveFailures++;
        if (endpoint.consecutiveFailures >= this.config.failureThreshold) {
          endpoint.healthy = false;
          console.warn(`[RPC] ${endpoint.name} marked unhealthy (health check failed)`);
        }
      }
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    // Initial health check
    this.runHealthChecks().catch(console.error);

    // Periodic health checks
    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks().catch(console.error);
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health checks (for cleanup)
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Get count of healthy endpoints
   */
  private getHealthyEndpointCount(): number {
    return this.endpoints.filter(e => e.healthy).length;
  }

  /**
   * Get status of all endpoints
   */
  getStatus(): {
    endpoints: {
      name: string;
      healthy: boolean;
      priority: number;
      avgResponseTime: number;
      totalRequests: number;
      failedRequests: number;
      successRate: string;
    }[];
    primaryEndpoint: string;
    activeEndpoint: string;
    healthyCount: number;
    totalCount: number;
  } {
    const activeEndpoint = this.endpoints.find(e => e.healthy) || this.endpoints[0];

    return {
      endpoints: this.endpoints.map(e => ({
        name: e.name,
        healthy: e.healthy,
        priority: e.priority,
        avgResponseTime: Math.round(e.avgResponseTime),
        totalRequests: e.totalRequests,
        failedRequests: e.failedRequests,
        successRate: e.totalRequests > 0
          ? `${((1 - e.failedRequests / e.totalRequests) * 100).toFixed(1)}%`
          : 'N/A',
      })),
      primaryEndpoint: this.endpoints[0].name,
      activeEndpoint: activeEndpoint.name,
      healthyCount: this.getHealthyEndpointCount(),
      totalCount: this.endpoints.length,
    };
  }

  /**
   * Helper: Execute with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timed out after ${timeout}ms`));
      }, timeout);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Helper: Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Force failover to next healthy endpoint (for testing/manual override)
   */
  forceFailover(currentEndpointName: string): boolean {
    const current = this.endpoints.find(e => e.name === currentEndpointName);
    if (current) {
      current.healthy = false;
      current.consecutiveFailures = this.config.failureThreshold;
      console.log(`[RPC] Forced failover from ${currentEndpointName}`);
      return true;
    }
    return false;
  }

  /**
   * Reset all endpoints to healthy (for recovery)
   */
  resetAllEndpoints(): void {
    for (const endpoint of this.endpoints) {
      endpoint.healthy = true;
      endpoint.consecutiveFailures = 0;
    }
    console.log('[RPC] All endpoints reset to healthy');
  }
}

// Singleton instance
let rpcProviderInstance: RPCProvider | null = null;

/**
 * Get the singleton RPC provider instance
 */
export function getRPCProvider(): RPCProvider {
  if (!rpcProviderInstance) {
    rpcProviderInstance = new RPCProvider();
  }
  return rpcProviderInstance;
}

/**
 * Get a connection from the RPC provider (convenience function)
 */
export function getConnection(): Connection {
  return getRPCProvider().getConnection();
}

/**
 * Execute an operation with automatic failover (convenience function)
 */
export async function executeWithFailover<T>(
  operation: (connection: Connection) => Promise<T>,
  operationName?: string
): Promise<T> {
  return getRPCProvider().executeWithFailover(operation, operationName);
}

/**
 * Get RPC provider status
 */
export function getRPCStatus() {
  return getRPCProvider().getStatus();
}

export { RPCProvider };
