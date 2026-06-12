export const config = {
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET || "campusride-local-dev-secret",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5173"
};
