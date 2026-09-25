import { redirect } from "next/navigation";
import { auth, googleAuthEnabled } from "@/lib/auth";
import { SignInForm } from "@/components/auth/sign-in-form";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/decks"); // already signed in

  return <SignInForm googleEnabled={googleAuthEnabled} />;
}
