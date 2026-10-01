// What the app records about the people who use it, shown to each of them once (and again
// whenever it changes: bump NOTICE_VERSION). Plain words; no database access here.

export const NOTICE_VERSION = 1;

export function noticeItems(company: string): { title: string; items: string[]; who: string; keep: string } {
  return {
    title: "Before you start: what this app records",
    items: [
      "Your location, only at the moment you take a photo for a job. Not all day, and not when the app is closed.",
      "The photos you take for jobs, stamped with the time and place, and a selfie when a job asks for one.",
      "When you arrive at and leave each job, your notes, and the customer's signature or code.",
      "Which phone you use (a random ID kept in this browser) and the country your internet connection comes from, so check-ins can't be sent for someone else.",
      "Your logins, including wrong PINs.",
    ],
    who: `Your managers at ${company} see it. It is used to confirm work was done, for pay and for customer records.`,
    keep: `It is kept while ${company} uses this app. Ask your manager if you want to see or correct what is recorded about you.`,
  };
}
