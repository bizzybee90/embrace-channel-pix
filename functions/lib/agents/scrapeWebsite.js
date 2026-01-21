"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeWebsite = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const params_1 = require("firebase-functions/params");
const axios_1 = __importDefault(require("axios"));
const firecrawlApiKey = (0, params_1.defineSecret)("FIRECRAWL_API_KEY");
exports.scrapeWebsite = (0, https_1.onCall)({ secrets: [firecrawlApiKey], timeoutSeconds: 300 }, async (request) => {
    var _a;
    const db = admin.firestore();
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be logged in.");
    const { url, company_id } = request.data;
    if (!url || !company_id) {
        throw new https_1.HttpsError("invalid-argument", "Missing url or company_id");
    }
    const apiKey = firecrawlApiKey.value();
    try {
        const response = await axios_1.default.post("https://api.firecrawl.dev/v1/scrape", {
            url: url,
            formats: ["markdown"],
            onlyMainContent: true
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            }
        });
        if (!response.data.success) {
            throw new Error(`Firecrawl failed: ${response.data.error || 'Unknown error'}`);
        }
        const markdown = response.data.data.markdown;
        // Save raw content to Firestore for caching
        await db
            .collection(`companies/${company_id}/scrapes`)
            .add({
            url,
            content: markdown,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true, markdown };
    }
    catch (error) {
        logger.error("Scrape Error", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        throw new https_1.HttpsError("internal", "Failed to scrape website");
    }
});
//# sourceMappingURL=scrapeWebsite.js.map