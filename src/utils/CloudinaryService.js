const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const API_KEY = import.meta.env.VITE_CLOUDINARY_API_KEY;
const API_SECRET = import.meta.env.VITE_CLOUDINARY_API_SECRET;

export const uploadImage = async (file) => {
    if (!file) return null;

    const timestamp = Math.round((new Date()).getTime() / 1000);

    // Generate signature using SHA-1
    // String to sign: "timestamp=...&upload_preset=... (if used)" + api_secret
    // Standard signed upload parameters sorted alphabetically
    const paramsToSign = `timestamp=${timestamp}`;
    const stringToSign = `${paramsToSign}${API_SECRET}`;

    // Calculate SHA-1 digest
    const signature = await sha1(stringToSign);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("api_key", API_KEY);
    formData.append("timestamp", timestamp);
    formData.append("signature", signature);

    try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || "Upload failed");
        }

        const data = await response.json();
        return data.secure_url;
    } catch (error) {
        console.error("Cloudinary upload error:", error);
        throw error;
    }
};

// Helper to calculate SHA-1 hex
async function sha1(str) {
    const buffer = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-1", buffer);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}
