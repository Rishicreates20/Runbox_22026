import type { Metadata } from "next";
import UploadForm from "./UploadForm";

export const metadata: Metadata = { title: "Upload a problem" };

export default function AdminPage() {
  return (
    <main className="container admin">
      <h1>Upload a problem</h1>
      <p className="hint">
        Paste a problem as JSON. It is validated against the same Zod schema the API uses (see{" "}
        <code>packages/shared/src/problem.ts</code> and the files in <code>problems/</code>). Validating needs no
        token; saving needs the server&apos;s <code>ADMIN_TOKEN</code>.
      </p>
      <UploadForm />
    </main>
  );
}
