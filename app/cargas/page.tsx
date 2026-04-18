import { redirect } from "next/navigation";

export default function CargasPage() {
  redirect("/modulos?tab=cargas");
}
