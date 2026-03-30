import { useMemo, useState } from 'react';

export default function FlashList({
  items = [],
  height = 320,
  itemHeight = 54,
  overscan = 6,
  keyExtractor = (item, index) => item?.id || `${index}`,
  renderItem,
  emptyCopy = 'No rows yet',
  className = ''
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const total = items.length;
  const safeItemHeight = Math.max(1, Number(itemHeight) || 54);
  const visibleCount = Math.max(1, Math.ceil(height / safeItemHeight));
  const start = Math.max(0, Math.floor(scrollTop / safeItemHeight) - overscan);
  const end = Math.min(total, start + visibleCount + overscan * 2);
  const topPad = start * safeItemHeight;
  const bottomPad = Math.max(0, (total - end) * safeItemHeight);

  const windowItems = useMemo(() => {
    return items.slice(start, end);
  }, [items, start, end]);

  if (total === 0) {
    return (
      <div className={`flash-list-empty ${className}`.trim()} style={{ height }}>
        {emptyCopy}
      </div>
    );
  }

  return (
    <div className={`flash-list ${className}`.trim()} style={{ height }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: topPad }} />
      {windowItems.map((item, index) => {
        const listIndex = start + index;
        return (
          <div key={keyExtractor(item, listIndex)} className="flash-list-row" style={{ minHeight: safeItemHeight }}>
            {renderItem(item, listIndex)}
          </div>
        );
      })}
      <div style={{ height: bottomPad }} />
    </div>
  );
}
