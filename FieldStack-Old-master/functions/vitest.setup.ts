import * as admin from "firebase-admin";

// Initialize Firebase Admin with a dummy project for testing
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "test-project" });
}
