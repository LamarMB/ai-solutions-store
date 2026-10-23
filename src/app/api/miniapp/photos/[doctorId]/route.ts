import { photoResponse } from "@/miniapp/photos";
import { photoStore } from "@/miniapp/server";

/**
 * Фото врача — публичные данные клиники (как имя и специальность), поэтому без
 * подписи ВКонтакте: тег <img> не умеет передавать заголовки. Отдаются только
 * проверенные при загрузке JPEG, PNG и WebP.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/api/miniapp/photos/[doctorId]">,
) {
  const { doctorId } = await context.params;
  return photoResponse(request, photoStore(), doctorId);
}
