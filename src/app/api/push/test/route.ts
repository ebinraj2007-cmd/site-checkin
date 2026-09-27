import { NextResponse } from "next/server";
import { apiUser } from "@/lib/api";
import { notifyUsers } from "@/lib/push";

export async function POST(req: Request) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const sent = await notifyUsers([user.id], {
    title: "Job alerts work",
    body: "New jobs will show up like this.",
    url: user.role === "manager" ? "/m" : "/w",
    tag: "test",
  });
  return NextResponse.json({ sent });
}
