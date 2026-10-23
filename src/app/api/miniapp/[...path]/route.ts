import { handleMiniAppApi } from "@/miniapp/api";
import { miniAppDeps } from "@/miniapp/server";

/** API VK Mini App: подпись параметров запуска и права — в handleMiniAppApi. */
export const dynamic = "force-dynamic";

async function handle(
  request: Request,
  context: RouteContext<"/api/miniapp/[...path]">,
) {
  const deps = miniAppDeps();
  if (!deps)
    return Response.json(
      {
        ok: false,
        code: "not_configured",
        error: "Приложение ещё не настроено на сервере.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const { path } = await context.params;
  return handleMiniAppApi(request, path, deps);
}

export { handle as GET, handle as POST, handle as PATCH };
