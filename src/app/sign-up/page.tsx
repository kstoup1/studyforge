import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignUpForm } from "@/components/auth/sign-up-form";

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user) redirect("/decks"); // already signed in

  return <SignUpForm />;
}
