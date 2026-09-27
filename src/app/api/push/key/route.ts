import { NextResponse } from "next/server";
import { apiUser } from "@/lib/api";
import { getVapidPublicKey } from "@/lib/push";

export async function GET(req: Request) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  return NextResponse.json({ publicKey: await getVapidPublicKey() });
}
