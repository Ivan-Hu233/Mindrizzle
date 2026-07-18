/**
 * 通用函数：对当前选区包裹 <span> 并应用样式
 * @param style 样式键值对（如 { 'font-size': '16px', color: '#ff0000' }）
 */
function wrapSelectionWithSpan(style: Record<string, string>): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        console.warn('[customCommands] 无有效选区，无法应用样式');
        return;
    }

    const range = sel.getRangeAt(0);
    if (range.collapsed) {
        console.debug('[customCommands] 选区已折叠，不执行包裹');
        return;
    }

    try {
        // 提取选区内容（保留原有标签和样式）
        const contents = range.extractContents();

        // 创建 <span> 并应用样式
        const span = document.createElement('span');
        for (const [key, value] of Object.entries(style)) {
            span.style.setProperty(key, value);
        }
        span.appendChild(contents);

        // 将 <span> 插入到原位置
        range.insertNode(span);

        // 恢复选区：选中 <span> 内部全部内容（便于继续编辑）
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        sel.addRange(newRange);

        console.debug('[customCommands] 样式应用成功', style);
    } catch (error) {
        console.error('[customCommands] 包裹选区时发生错误:', error);
    }
}

/**
 * 自定义应用字号（精确像素）
 * @param size 字号（像素值，如 16）
 */
export function customApplyFontSize(size: number): void {
    if (typeof size !== 'number' || size <= 0) {
        console.warn('[customCommands] 无效字号，必须为正数');
        return;
    }
    wrapSelectionWithSpan({ 'font-size': `${size}px` });
}

/**
 * 自定义应用高亮（背景色）
 * @param color CSS 颜色值（如 '#FFEB3B'、'rgba(255,0,0,0.5)'）
 */
export function customApplyHighlight(color: string): void {
    if (!color) {
        console.warn('[customCommands] 未提供颜色，使用默认黄色');
        color = '#FFEB3B'; // 默认高亮色
    }
    wrapSelectionWithSpan({ 'background-color': color });
}

/**
 * 自定义应用任意内联样式
 * @param style 样式对象（如 { color: 'red', 'font-weight': 'bold' }）
 */
export function customApplyInlineStyle(style: Record<string, string>): void {
    if (!style || Object.keys(style).length === 0) {
        console.warn('[customCommands] 样式对象为空，忽略操作');
        return;
    }
    wrapSelectionWithSpan(style);
}