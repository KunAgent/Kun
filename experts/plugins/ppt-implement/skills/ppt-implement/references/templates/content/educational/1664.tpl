<!-- Template: 教育风格-变体24 (Content #1664) - Python循环·for语句 -->
<div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-[#1a1a2e] to-[#16213e]">
    
    <!-- 内容填充区域 -->
    <div class="w-[1350px] h-[720px] mx-auto my-[20px] flex flex-col">
        
        <!-- 标题区 -->
        <div class="text-center pt-5 pb-6">
            <h1 class="text-[42px] font-bold text-emerald-400 mb-2 font-mono">for 循环</h1>
            <p class="text-[18px] text-slate-400 font-mono">重复执行代码的魔法</p>
        </div>
        
        <!-- 主内容区 -->
        <div class="grid grid-cols-2 gap-6 px-4 flex-1">
            
            <!-- 左侧：代码示例 -->
            <div class="space-y-5">
                <div class="bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden">
                    <div class="bg-slate-800 px-4 py-2 border-b border-slate-700">
                        <span class="text-[12px] text-emerald-400 font-mono">基本语法</span>
                    </div>
                    <div class="p-5 font-mono text-[14px] space-y-1">
                        <div class="flex"><span class="text-slate-500 w-8">1</span><span><span class="text-pink-400">for</span> <span class="text-sky-300">i</span> <span class="text-pink-400">in</span> <span class="text-violet-400">range</span>(<span class="text-amber-400">5</span>):</span></div>
                        <div class="flex"><span class="text-slate-500 w-8">2</span><span class="ml-8"><span class="text-emerald-400">print</span>(<span class="text-sky-300">i</span>)</span></div>
                    </div>
                </div>
                <div class="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-5">
                    <h3 class="text-[18px] font-bold text-emerald-400 mb-3 font-mono">运行结果</h3>
                    <div class="bg-slate-900/50 rounded-lg p-4 font-mono text-emerald-300 text-[14px] space-y-0.5">
                        <div>0</div><div>1</div><div>2</div><div>3</div><div>4</div>
                    </div>
                </div>
            </div>
            
            <!-- 右侧：说明区 -->
            <div class="space-y-5">
                <div class="bg-slate-800/50 rounded-xl border border-slate-700 p-5">
                    <h3 class="text-[20px] font-bold text-white mb-4">理解 range() 函数</h3>
                    <div class="space-y-3 text-[14px]">
                        <div class="bg-slate-900/50 rounded-lg p-3">
                            <p class="text-sky-400 font-mono mb-1">range(5)</p>
                            <p class="text-slate-300">生成0,1,2,3,4 (从0开始，不包括5)</p>
                        </div>
                        <div class="bg-slate-900/50 rounded-lg p-3">
                            <p class="text-sky-400 font-mono mb-1">range(1, 6)</p>
                            <p class="text-slate-300">生成1,2,3,4,5 (从1到5)</p>
                        </div>
                        <div class="bg-slate-900/50 rounded-lg p-3">
                            <p class="text-sky-400 font-mono mb-1">range(0, 10, 2)</p>
                            <p class="text-slate-300">生成0,2,4,6,8 (步长为2)</p>
                        </div>
                    </div>
                </div>
                <div class="bg-sky-500/10 border border-sky-500/30 rounded-xl p-5">
                    <h3 class="text-[16px] font-bold text-sky-400 mb-3 flex items-center font-mono">
                        <span class="text-[18px] mr-2">💡</span>实战案例
                    </h3>
                    <div class="bg-slate-900/50 rounded-lg p-4 font-mono text-[13px] space-y-1">
                        <div class="text-slate-500"># 打印9的乘法表</div>
                        <div><span class="text-pink-400">for</span> <span class="text-sky-300">i</span> <span class="text-pink-400">in</span> <span class="text-violet-400">range</span>(<span class="text-amber-400">1</span>, <span class="text-amber-400">10</span>):</div>
                        <div class="ml-4"><span class="text-emerald-400">print</span>(<span class="text-emerald-400">f"9 x {"{"}i{"}"} = {"{"}9*i{"}"}"</span>)</div>
                    </div>
                </div>
            </div>
            
        </div>
        
    </div>
    
</div>
