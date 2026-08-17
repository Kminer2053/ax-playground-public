import { Schema, model, models, type InferSchemaType } from "mongoose";

const SalesOrderSchema = new Schema(
  {
    productName: { type: String, required: true },
    store: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    memo: { type: String },
    requestedBy: { type: String, required: true },
    status: { type: String, required: true, enum: ["requested", "approved", "ordered", "cancelled"], default: "requested" },
  },
  { timestamps: true },
);

export type SalesOrderDoc = InferSchemaType<typeof SalesOrderSchema>;
export const SalesOrderModel = models.SalesOrder ?? model("SalesOrder", SalesOrderSchema);
