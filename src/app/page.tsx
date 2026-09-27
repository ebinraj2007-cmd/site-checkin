import { redirect } from "next/navigation";
import { getSessionUser, hasAnyUser } from "@/lib/auth";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect((await hasAnyUser()) ? "/login" : "/setup");
  redirect(user.role === "manager" ? "/m" : "/w");
}
