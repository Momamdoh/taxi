const admin = require("firebase-admin");
const serviceAccount = require("../taxi-de878-firebase-adminsdk-fbsvc-b16a171e50.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
