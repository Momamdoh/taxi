// Import the Firebase Admin SDK
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
const serviceAccount = require("./e-commerce-d02dc-firebase-adminsdk-jrxbh-cd2ef20d25.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Define the target token and message
const targetToken = "dVYH70_OSaO9rFiC7hMAd0:APA91bHBr4hdx5cg_3aHe0lO7gf4nnNcmlWNM0kCNQH2i8W2FOaq0hJ1ryVnStSVqWKmrjK3O6VoFdaxKNHzhbC4R4w4IuyC9fRr_RdU_or2SFyOkB_AbQA";
const message = {
  notification: {
    title: "Ebook",
    body: "bye",
  },
  data: {
    route: "/notifications", 
  },
  token: targetToken,
};

admin
  .messaging()
  .send(message)
  .then((response) => {
    console.log("Message sent successfully:", response);
  })
  .catch((error) => {
    console.error("Error sending message:", error);
  });
