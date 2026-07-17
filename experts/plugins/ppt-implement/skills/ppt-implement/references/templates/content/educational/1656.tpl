<!-- Template: 教育风格-变体16 (Content #1656) - JavaScript基础·变量与数据类型 -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
        
        <!-- JavaScript教学布局 -->
        <div class="w-[1350px] h-[720px] mx-auto my-[20px] flex items-center justify-center">
            <div class="max-w-6xl w-full">
                <div class="flex items-center justify-between mb-5">
                    <div>
                        <h1 class="text-[32px] font-bold text-yellow-400 mb-1 font-mono">JavaScript 基础</h1>
                        <p class="text-[16px] text-gray-400 font-mono">变量声明 let, const, var</p>
                    </div>
                    <div class="text-[42px]">📦</div>
                </div>
                
                <div class="grid grid-cols-3 gap-4">
                    <div class="bg-gradient-to-br from-blue-900/40 to-blue-800/40 backdrop-blur-sm border-2 border-blue-500/50 rounded-xl p-4">
                        <h3 class="text-[20px] font-bold text-blue-400 mb-2 font-mono">let</h3>
                        <div class="space-y-2">
                            <div class="bg-slate-900 rounded-lg p-2 font-mono text-[12px]">
                                <div class="text-gray-500 mb-1">// 可以重新赋值</div>
                                <div><span class="text-pink-400">let</span> <span class="text-blue-300">age</span> = <span class="text-orange-400">10</span>;</div>
                                <div><span class="text-blue-300">age</span> = <span class="text-orange-400">11</span>; <span class="text-green-400">// ✓</span></div>
                            </div>
                            
                            <div class="bg-blue-500/10 rounded-lg p-2 text-[12px] space-y-1">
                                <p class="text-blue-300 font-semibold">特点：</p>
                                <p class="text-gray-300">✓ 块级作用域</p>
                                <p class="text-gray-300">✓ 可以修改</p>
                                <p class="text-gray-300">✓ 不能重复声明</p>
                            </div>
                            
                            <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-2 text-[12px] text-green-300">
                                <p class="font-semibold mb-0.5">推荐使用 ⭐</p>
                                <p>需要改变的变量</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="bg-gradient-to-br from-purple-900/40 to-purple-800/40 backdrop-blur-sm border-2 border-purple-500/50 rounded-xl p-4">
                        <h3 class="text-[20px] font-bold text-purple-400 mb-2 font-mono">const</h3>
                        <div class="space-y-2">
                            <div class="bg-slate-900 rounded-lg p-2 font-mono text-[12px]">
                                <div class="text-gray-500 mb-1">// 不能重新赋值</div>
                                <div><span class="text-pink-400">const</span> <span class="text-purple-300">PI</span> = <span class="text-orange-400">3.14</span>;</div>
                                <div><span class="text-purple-300">PI</span> = <span class="text-orange-400">3</span>; <span class="text-red-400">// ✗</span></div>
                            </div>
                            
                            <div class="bg-purple-500/10 rounded-lg p-2 text-[12px] space-y-1">
                                <p class="text-purple-300 font-semibold">特点：</p>
                                <p class="text-gray-300">✓ 块级作用域</p>
                                <p class="text-gray-300">✗ 不能修改</p>
                                <p class="text-gray-300">✗ 不能重复声明</p>
                            </div>
                            
                            <div class="bg-green-500/10 border border-green-500/30 rounded-lg p-2 text-[12px] text-green-300">
                                <p class="font-semibold mb-0.5">推荐使用 ⭐⭐</p>
                                <p>不变的常量</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="bg-gradient-to-br from-gray-800/40 to-gray-700/40 backdrop-blur-sm border-2 border-gray-500/50 rounded-xl p-4">
                        <h3 class="text-[20px] font-bold text-gray-400 mb-2 font-mono">var</h3>
                        <div class="space-y-2">
                            <div class="bg-slate-900 rounded-lg p-2 font-mono text-[12px]">
                                <div class="text-gray-500 mb-1">// 旧语法</div>
                                <div><span class="text-pink-400">var</span> <span class="text-gray-300">name</span> = <span class="text-green-400">"Tom"</span>;</div>
                                <div><span class="text-gray-300">name</span> = <span class="text-green-400">"Jerry"</span>; <span class="text-green-400">// ✓</span></div>
                            </div>
                            
                            <div class="bg-gray-500/10 rounded-lg p-2 text-[12px] space-y-1">
                                <p class="text-gray-300 font-semibold">特点：</p>
                                <p class="text-gray-300">✗ 函数作用域</p>
                                <p class="text-gray-300">✓ 可以修改</p>
                                <p class="text-gray-300">✓ 可以重复声明</p>
                            </div>
                            
                            <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-2 text-[12px] text-red-300">
                                <p class="font-semibold mb-0.5">不推荐 ⚠️</p>
                                <p>容易产生问题</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="mt-5 grid grid-cols-2 gap-4">
                    <div class="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4">
                        <h3 class="text-[16px] font-bold text-cyan-400 mb-2 flex items-center font-mono">
                            <span class="text-[18px] mr-2">📚</span>
                            使用建议
                        </h3>
                        <div class="space-y-1.5 text-[14px] text-gray-300">
                            <p class="flex items-start">
                                <span class="text-cyan-400 mr-2">1.</span>
                                <span>默认使用 <span class="text-purple-400 font-mono font-bold">const</span></span>
                            </p>
                            <p class="flex items-start">
                                <span class="text-cyan-400 mr-2">2.</span>
                                <span>需要改变值时用 <span class="text-blue-400 font-mono font-bold">let</span></span>
                            </p>
                            <p class="flex items-start">
                                <span class="text-cyan-400 mr-2">3.</span>
                                <span>不要使用 <span class="text-gray-500 font-mono font-bold line-through">var</span></span>
                            </p>
                        </div>
                    </div>
                    
                    <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                        <h3 class="text-[16px] font-bold text-yellow-400 mb-2 flex items-center font-mono">
                            <span class="text-[18px] mr-2">⚡</span>
                            实战示例
                        </h3>
                        <div class="bg-slate-900 rounded-lg p-2 font-mono text-[12px] space-y-0.5">
                            <div><span class="text-pink-400">const</span> <span class="text-purple-300">studentName</span> = <span class="text-green-400">"小明"</span>;</div>
                            <div><span class="text-pink-400">let</span> <span class="text-blue-300">score</span> = <span class="text-orange-400">90</span>;</div>
                            <div><span class="text-blue-300">score</span> = <span class="text-blue-300">score</span> + <span class="text-orange-400">5</span>;</div>
                            <div class="text-gray-500">// score现在是95</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
    </div>
