import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_SUCCESS_PATH = "/crm";
const AUTH_ERROR_PATH = "/sign-in?error=auth";

type OtpType =
  | "email"
  | "signup"
  | "invite"
  | "recovery"
  | "email_change"
  | "magiclink";

function createAuthClient(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[],
          headers?: Record<string, string>,
        ) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          if (headers) {
            Object.entries(headers).forEach(([key, value]) => {
              response.headers.set(key, value);
            });
          }
        },
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (code) {
    const response = NextResponse.redirect(`${origin}${AUTH_SUCCESS_PATH}`);
    const supabase = createAuthClient(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return response;
    }
  }

  if (tokenHash && type) {
    const response = NextResponse.redirect(`${origin}${AUTH_SUCCESS_PATH}`);
    const supabase = createAuthClient(request, response);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as OtpType,
    });
    if (!error) {
      return response;
    }
  }

  return NextResponse.redirect(`${origin}${AUTH_ERROR_PATH}`);
}
