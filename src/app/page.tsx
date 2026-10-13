import { redirect } from "next/navigation";
import { getCurrentSession } from "@/auth/session";

export default async function Home() {
  const session = await getCurrentSession();
  redirect(session ? "/panel" : "/login");
}
