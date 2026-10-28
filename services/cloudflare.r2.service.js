const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

const safeName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

class R2Service {

    uploadImage = async (file) => {
        const key = `courses/${crypto.randomUUID()}-${safeName(file.originalname)}`;

        await s3.send(new PutObjectCommand({
            Bucket: process.env.R2_PUBLIC_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));

        return `${process.env.R2_PUBLIC_URL}/${key}`;
    };

    deleteImage = (url) =>
        s3.send(new DeleteObjectCommand({
            Bucket: process.env.R2_PUBLIC_BUCKET,
            Key: url.replace(`${process.env.R2_PUBLIC_URL}/`, "")
    }));

    uploadAttachment = async (file) => {
        const key = `lessons/${crypto.randomUUID()}/${safeName(file.originalname)}`;

        await s3.send(new PutObjectCommand({
            Bucket: process.env.R2_ATTACHMENTS_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));

        return key;
    };

    uploadAttachments = (files = []) =>
        Promise.all(files.map(this.uploadAttachment));

    getAttachmentUrl = (key, ttlSeconds = 3600) =>
        getSignedUrl(
            s3,
            new GetObjectCommand({
                Bucket: process.env.R2_ATTACHMENTS_BUCKET,
                Key: key
            }),
            { expiresIn: ttlSeconds }
        );
    
    deleteAttachment = (key) =>
        s3.send(new DeleteObjectCommand({
            Bucket: process.env.R2_ATTACHMENTS_BUCKET,
            Key: key
        }));

    getAttachmentLinks = (keys = []) =>
        Promise.all(
            keys.map(async (key) => ({
                key,
                url: await this.getAttachmentUrl(key)
            }))
        );

    uploadChatImage = async (file) => {
        const key = `chats/${crypto.randomUUID()}-${safeName(file.originalname)}`;

        await s3.send(new PutObjectCommand({
            Bucket: process.env.R2_PUBLIC_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype
        }));

        return `${process.env.R2_PUBLIC_URL}/${key}`;
    };

    deleteChatImage = (url) =>
        s3.send(new DeleteObjectCommand({
            Bucket: process.env.R2_PUBLIC_BUCKET,
            Key: url.replace(`${process.env.R2_PUBLIC_URL}/`, "")
        }));
}

module.exports = new R2Service();