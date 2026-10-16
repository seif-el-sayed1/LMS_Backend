const crypto = require("crypto");
const ApiError = require("../utils/ApiError"); 

class BunnyService {
    createVideo = async (title) => {
        const res = await fetch(
            `https://video.bunnycdn.com/library/${process.env.BUNNY_LIBRARY_ID}/videos`,
            {
                method: "POST",
                headers: {
                    AccessKey: process.env.BUNNY_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ title })
            }
        );

        if (!res.ok) throw new ApiError("Failed to create video", 502);
        return res.json();
    };

    signUpload = (videoId) => {
        const expire = Math.floor(Date.now() / 1000) + 3600;
        const signature = crypto
            .createHash("sha256")
            .update(`${process.env.BUNNY_LIBRARY_ID}${process.env.BUNNY_API_KEY}${expire}${videoId}`)
            .digest("hex");

        return {
            videoId,
            libraryId: process.env.BUNNY_LIBRARY_ID,
            signature,
            expire
        };
    };

    deleteVideo = async (videoId) => {
        const res = await fetch(
            `https://video.bunnycdn.com/library/${process.env.BUNNY_LIBRARY_ID}/videos/${videoId}`,
            {
                method: "DELETE",
                headers: { AccessKey: process.env.BUNNY_API_KEY }
            }
        );

        if (!res.ok && res.status !== 404) {
            throw new ApiError("Failed to delete video", 502);
        }   
    };

    getVideo = async (videoId) => {
        const res = await fetch(
            `https://video.bunnycdn.com/library/${process.env.BUNNY_LIBRARY_ID}/videos/${videoId}`,
            { headers: { AccessKey: process.env.BUNNY_API_KEY } }
        );

        if (!res.ok) throw new ApiError("Failed to fetch video", 502);
        return res.json();
    };

    getSignedEmbedUrl = (videoId, ttlSeconds = 10) => {
        const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

        const token = crypto
            .createHash("sha256")
            .update(process.env.BUNNY_TOKEN_AUTH_KEY + videoId + expires)
            .digest("hex");

        const url =
            `https://iframe.mediadelivery.net/embed/${process.env.BUNNY_LIBRARY_ID}/${videoId}` +
            `?token=${token}&expires=${expires}`;

        return { url, expiresAt: new Date(expires * 1000) };
    };


    verifyWebhookSignature = (rawBody, headers) => {
        if (headers["x-bunnystream-signature-version"] !== "v1") return false;
        if (headers["x-bunnystream-signature-algorithm"] !== "hmac-sha256") return false;

        const signature = headers["x-bunnystream-signature"];
        const expected = crypto
            .createHmac("sha256", process.env.BUNNY_READ_ONLY_API_KEY)
            .update(rawBody)
            .digest("hex");

        if (
            typeof signature !== "string" ||
            signature.length !== expected.length ||
            !/^[0-9a-f]+$/.test(signature)
        ) {
            return false;
        }

        return crypto.timingSafeEqual(
            Buffer.from(expected, "utf8"),
            Buffer.from(signature, "utf8")
        );
    };

}

module.exports = new BunnyService();