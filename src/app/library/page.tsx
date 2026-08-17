import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { recordUsage } from "@/lib/usage";

export const metadata = { title: "AX 라이브러리 — AX Playground" };
export const dynamic = "force-dynamic";

export default function LibraryPage() {
  recordUsage("library", "enter");
  return <LibraryBrowser />;
}
