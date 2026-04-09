import { NextResponse } from "next/server";
// import { Resend } from "resend";

// const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { email, role, designation, token } = (await request.json()) as {
      email?: string;
      role?: string;
      designation?: string | null;
      token?: string;
    };

    const toEmail = typeof email === "string" ? email.trim() : "";
    const inviteToken = typeof token === "string" ? token.trim() : "";
    if (!toEmail || !inviteToken) {
      return NextResponse.json({ error: "Missing email or token" }, { status: 400 });
    }

    // const inviteLink = `http://localhost:3000/join?token=${encodeURIComponent(inviteToken)}`;
    // const roleLine =
    //   typeof designation === "string" && designation.trim() !== ""
    //     ? `${String(role)} (${designation.trim()})`
    //     : String(role ?? "team member");

    // const { data, error } = await resend.emails.send({
    //   from: "DocPad Admin <onboarding@resend.dev>",
    //   to: toEmail,
    //   subject: "You have been invited to DocPad",
    //   html: `
    //     <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
    //       <h2>Welcome to DocPad!</h2>
    //       <p>You have been invited to join Rameshwar Dass Memorial Hospital as a <strong>${roleLine}</strong>.</p>
    //       <p>Click the secure button below to set up your account credentials:</p>
    //       <a href="${inviteLink}" style="display: inline-block; padding: 12px 24px; background-color: #1a56ff; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px; font-weight: bold;">Accept Invitation</a>
    //       <p style="margin-top: 32px; color: #666; font-size: 12px;">If the button doesn't work, copy and paste this link into your browser: <br/> ${inviteLink}</p>
    //     </div>
    //   `,
    // });
    // if (error) {
    //   return NextResponse.json({ error: error.message }, { status: 500 });
    // }

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    console.log(`Invite URL: ${process.env.NEXT_PUBLIC_APP_URL}/auth/signup?token=${inviteToken}`);

    return NextResponse.json({
      message: "Invitation created (email disabled for testing)",
      inviteUrl: `${baseUrl}/auth/signup?token=${inviteToken}`,
    });
  } catch (err) {
    console.error("Server crashed:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
