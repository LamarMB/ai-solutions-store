/** Полоса о демо-характере сайта — на всех страницах. */
export function DemoBar() {
  return (
    <div className="border-demo-ink/15 bg-demo-bg text-demo-ink border-b">
      <p className="max-w-page text-caption mx-auto px-4 py-2 text-center font-medium sm:px-6 lg:px-8">
        Демо-версия сайта: решения, цены и описания демонстрационные
      </p>
    </div>
  );
}
