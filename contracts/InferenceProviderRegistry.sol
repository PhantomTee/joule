// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title InferenceProviderRegistry
 * @notice On-chain reputation and discovery registry for Joule inference providers.
 *         Each provider reports metrics hourly; reputation accumulates on-chain so
 *         buyer agents can discover and rank providers trustlessly.
 */
contract InferenceProviderRegistry {

    // ── Structs ───────────────────────────────────────────────────────────────

    struct ReputationScore {
        uint64  uptimePct;       // 0–100 (integer %)
        uint64  avgLatencyMs;    // exponential moving average
        uint64  errorRatePpm;    // errors per million reports
        uint64  totalSessions;   // number of reportMetrics() calls
        uint256 totalRevenue;    // cumulative USDC earned (6 decimals)
    }

    struct Provider {
        uint256 id;
        string  modelName;
        uint256 basePrice;       // USDC/sec, 6 decimals (e.g. 200 = 0.0002 USDC)
        string  features;        // comma-separated: "streaming,tokenCounting"
        address walletAddress;   // SELLER_ADDRESS — only this can report/deactivate
        bool    isActive;
        uint256 totalInferenceSeconds;
        uint256 totalUSDCEarned; // 6 decimals
        uint256 registeredAt;
        uint256 lastReportAt;
        ReputationScore reputation;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    uint256 private _nextId = 1;
    mapping(uint256 => Provider) private _providers;
    mapping(address => uint256)  public  providerIdByWallet;
    uint256[] private _allIds;

    // ── Events ────────────────────────────────────────────────────────────────

    event ProviderRegistered(uint256 indexed providerId, address indexed wallet, string modelName);
    event MetricsReported(uint256 indexed providerId, uint256 secondsRun, uint256 earnedUsdc);
    event ProviderDeactivated(uint256 indexed providerId);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyProvider(uint256 providerId) {
        require(
            _providers[providerId].walletAddress == msg.sender,
            "InferenceProviderRegistry: caller is not the provider wallet"
        );
        _;
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * @notice Register (or re-register) a provider. One registration per wallet
     *         address — subsequent calls update model/price/features and re-activate.
     * @param modelName  Human-readable model identifier, e.g. "qwen2.5-0.5b-instruct"
     * @param basePrice  Base price in USDC atomic units per second (6 decimals)
     * @param features   Comma-separated capability tags
     * @param walletAddress  The provider's payout wallet (msg.sender must match on writes)
     * @return providerId  Stable numeric ID for this provider
     */
    function registerProvider(
        string  calldata modelName,
        uint256 basePrice,
        string  calldata features,
        address walletAddress
    ) external returns (uint256 providerId) {
        uint256 existing = providerIdByWallet[walletAddress];
        if (existing != 0) {
            Provider storage p = _providers[existing];
            p.modelName = modelName;
            p.basePrice = basePrice;
            p.features  = features;
            p.isActive  = true;
            emit ProviderRegistered(existing, walletAddress, modelName);
            return existing;
        }
        providerId = _nextId++;
        _providers[providerId] = Provider({
            id:                    providerId,
            modelName:             modelName,
            basePrice:             basePrice,
            features:              features,
            walletAddress:         walletAddress,
            isActive:              true,
            totalInferenceSeconds: 0,
            totalUSDCEarned:       0,
            registeredAt:          block.timestamp,
            lastReportAt:          block.timestamp,
            reputation: ReputationScore({
                uptimePct:     100,
                avgLatencyMs:  0,
                errorRatePpm:  0,
                totalSessions: 0,
                totalRevenue:  0
            })
        });
        providerIdByWallet[walletAddress] = providerId;
        _allIds.push(providerId);
        emit ProviderRegistered(providerId, walletAddress, modelName);
    }

    // ── Metric reporting ─────────────────────────────────────────────────────

    /**
     * @notice Report an hourly metrics snapshot for this provider. Only callable
     *         by the registered wallet address (onlyProvider guard).
     * @param providerId  As returned by registerProvider
     * @param secondsRun  Total inference seconds served since last report
     * @param earnedUsdc  USDC earned (atomic, 6 dec) since last report
     * @param errorCount  Number of failed inference calls since last report
     * @param avgLatencyMs  Rolling average response latency in milliseconds
     */
    function reportMetrics(
        uint256 providerId,
        uint256 secondsRun,
        uint256 earnedUsdc,
        uint64  errorCount,
        uint64  avgLatencyMs
    ) external onlyProvider(providerId) {
        Provider storage p = _providers[providerId];
        p.totalInferenceSeconds += secondsRun;
        p.totalUSDCEarned       += earnedUsdc;
        p.lastReportAt           = block.timestamp;

        ReputationScore storage r = p.reputation;
        r.totalSessions += 1;
        r.totalRevenue  += earnedUsdc;

        // Latency: 7/8 weight on history, 1/8 on new observation (EMA, α=0.125)
        if (r.avgLatencyMs == 0) {
            r.avgLatencyMs = avgLatencyMs;
        } else {
            r.avgLatencyMs = (r.avgLatencyMs * 7 + avgLatencyMs) / 8;
        }

        // Error rate: errors this session vs total sessions (simple ratio, ppm)
        if (r.totalSessions > 0) {
            r.errorRatePpm = (uint256(errorCount) * 1_000_000 / r.totalSessions) > type(uint64).max
                ? type(uint64).max
                : uint64(uint256(errorCount) * 1_000_000 / r.totalSessions);
        }

        emit MetricsReported(providerId, secondsRun, earnedUsdc);
    }

    // ── Read views ────────────────────────────────────────────────────────────

    function getProvider(uint256 providerId) external view returns (Provider memory) {
        return _providers[providerId];
    }

    function getProviderReputation(uint256 providerId) external view returns (ReputationScore memory) {
        return _providers[providerId].reputation;
    }

    /**
     * @notice Returns ALL provider IDs ever registered (active + inactive).
     *         Off-chain callers filter by isActive and sort by their preferred metric.
     */
    function getAllProviderIds() external view returns (uint256[] memory) {
        return _allIds;
    }

    function totalProviders() external view returns (uint256) {
        return _allIds.length;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function deactivateProvider(uint256 providerId) external onlyProvider(providerId) {
        _providers[providerId].isActive = false;
        emit ProviderDeactivated(providerId);
    }
}
