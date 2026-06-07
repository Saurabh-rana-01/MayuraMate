import emailjs from '@emailjs/browser';

// Service ID and Template ID from EmailJS
// TODO: Replace with your actual EmailJS IDs
const SERVICE_ID = "service_0b3enkd";
const TEMPLATE_ID = "template_y4858me";
const PUBLIC_KEY = "P0YGTH1qQrWp1tNtU";

export const sendOnlineNotification = async (recipientEmail, senderName) => {
    try {
        const templateParams = {
            to_email: recipientEmail,
            from_name: "Chat App",
            message: `${senderName} is now online! Start chatting.`,
        };

        await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY);
        console.log("Email sent successfully");
    } catch (error) {
        console.error("Failed to send email:", error);
    }
};
