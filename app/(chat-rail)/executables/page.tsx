/**
 * @fileType page
 * @domain executables
 * @pattern executables-redirect
 * @ai-summary Legacy route. Executables are now "Pipeline" duties — folder
 *   duties at `.kody/duties/<slug>/`. This route redirects to the Duties
 *   page's Pipeline tab so old links/bookmarks keep working.
 */
import { redirect } from "next/navigation";

export default function ExecutablesPage() {
  redirect("/duties?tab=pipeline");
}
