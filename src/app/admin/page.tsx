import { isAdmin } from "@/lib/adminAuth";
import { AdminKeyGate } from "@/components/admin/AdminKeyGate";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "관리자 — AX Playground" };

export default async function AdminPage() {
  if (!(await isAdmin())) return <AdminKeyGate />;
  return <AdminDashboard />;
}
