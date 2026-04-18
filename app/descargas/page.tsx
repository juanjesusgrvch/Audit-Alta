import { redirect } from "next/navigation";

export default function DescargasPage() {
  redirect("/modulos?tab=descargas");
}
