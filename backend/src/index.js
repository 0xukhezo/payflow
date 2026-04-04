import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import companyRoutes from "./routes/company.js";
import payrollRoutes from "./routes/payroll.js";
import employeeRoutes from "./routes/employee.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/company", companyRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/employee", employeeRoutes);

app.listen(PORT, () => {
  console.log(`PayFlow backend running on port ${PORT}`);
});

export default app;
