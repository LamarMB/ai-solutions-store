import { handleAdminApi } from "@/admin/api";
import { adminDeps } from "@/admin/server";

/** API админ-панели: авторизация, проверка источника и данных — в handleAdminApi. */
export const dynamic = "force-dynamic";

async function handle(
  request: Request,
  context: RouteContext<"/api/admin/[...path]">,
) {
  const { path } = await context.params;
  return handleAdminApi(request, path, adminDeps());
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
