<!-- Template: 教育风格-变体20 (Content #1660) - CSS基础·盒模型 -->
<div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-[#0f172a] via-[#1e1b4b] to-[#0f172a]">
    
    <!-- 背景装饰 -->
    <div class="absolute inset-0">
        <div class="absolute top-0 right-0 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-3xl"></div>
        <div class="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-3xl"></div>
        <!-- 网格背景 -->
        <div class="absolute inset-0 opacity-[0.03]" style="background-image: linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px); background-size: 40px 40px;"></div>
    </div>
    
    <!-- CSS盒模型教学布局 -->
    <div class="w-[1350px] h-[720px] mx-auto my-[20px] flex flex-col relative z-10">
        
        <!-- 标题区 -->
        <div class="text-center pt-6 pb-8">
            <div class="inline-flex items-center gap-3 mb-3">
                <div class="w-10 h-1 bg-gradient-to-r from-transparent to-cyan-400 rounded-full"></div>
                <span class="text-[14px] text-cyan-400/80 font-mono tracking-wider uppercase">CSS Fundamentals</span>
                <div class="w-10 h-1 bg-gradient-to-l from-transparent to-cyan-400 rounded-full"></div>
            </div>
            <h1 class="text-[42px] font-bold bg-gradient-to-r from-cyan-400 via-white to-purple-400 bg-clip-text text-transparent font-mono">盒模型 Box Model</h1>
        </div>
        
        <!-- 主内容区 -->
        <div class="flex-1 flex items-center gap-12 px-8">
            
            <!-- 左侧：交互式盒模型可视化 -->
            <div class="flex-1 flex items-center justify-center">
                <div class="relative">
                    <!-- Margin 层 -->
                    <div class="relative p-6 rounded-2xl border-2 border-dashed border-orange-400/60 bg-orange-500/5">
                        <div class="absolute -top-3 left-6 px-3 py-0.5 bg-[#0f172a] rounded">
                            <span class="text-[13px] text-orange-400 font-mono font-semibold">margin</span>
                        </div>
                        <div class="absolute top-1/2 -left-12 -translate-y-1/2 flex items-center gap-1">
                            <span class="text-[12px] text-orange-400/70 font-mono">20px</span>
                            <div class="w-6 h-[2px] bg-orange-400/50"></div>
                        </div>
                        
                        <!-- Border 层 -->
                        <div class="relative p-5 rounded-xl border-[3px] border-green-400 bg-green-500/5 shadow-[0_0_20px_rgba(74,222,128,0.15)]">
                            <div class="absolute -top-3 left-6 px-3 py-0.5 bg-[#0f172a] rounded">
                                <span class="text-[13px] text-green-400 font-mono font-semibold">border</span>
                            </div>
                            <div class="absolute top-1/2 -right-16 -translate-y-1/2 flex items-center gap-1">
                                <div class="w-6 h-[2px] bg-green-400/50"></div>
                                <span class="text-[12px] text-green-400/70 font-mono">3px</span>
                            </div>
                            
                            <!-- Padding 层 -->
                            <div class="relative p-6 rounded-lg bg-purple-500/10 border border-purple-400/30">
                                <div class="absolute -top-3 left-6 px-3 py-0.5 bg-[#1a1744] rounded">
                                    <span class="text-[13px] text-purple-400 font-mono font-semibold">padding</span>
                                </div>
                                <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                                    <div class="w-[2px] h-4 bg-purple-400/50"></div>
                                    <span class="text-[12px] text-purple-400/70 font-mono">16px</span>
                                </div>
                                
                                <!-- Content 层 -->
                                <div class="w-[200px] h-[120px] rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
                                    <div class="text-center">
                                        <span class="text-white font-mono font-bold text-[16px] block">content</span>
                                        <span class="text-cyan-100/80 font-mono text-[12px]">200 × 120</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 右侧：属性说明卡片 -->
            <div class="w-[520px] space-y-4">
                
                <!-- Content 说明 -->
                <div class="group flex items-start gap-4 p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 to-transparent border border-cyan-500/20 hover:border-cyan-500/40 transition-all">
                    <div class="w-3 h-3 mt-1.5 rounded-full bg-cyan-500 shadow-lg shadow-cyan-500/50"></div>
                    <div class="flex-1">
                        <div class="flex items-baseline gap-3 mb-1">
                            <h3 class="text-[18px] font-bold text-cyan-400 font-mono">content</h3>
                            <span class="text-[12px] text-gray-500">内容区域</span>
                        </div>
                        <p class="text-gray-400 text-[14px] mb-2">元素的实际内容，如文字、图片等</p>
                        <code class="inline-block px-3 py-1 bg-slate-800/80 rounded text-[12px] text-cyan-300 font-mono">width: 200px; height: 120px;</code>
                    </div>
                </div>
                
                <!-- Padding 说明 -->
                <div class="group flex items-start gap-4 p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-transparent border border-purple-500/20 hover:border-purple-500/40 transition-all">
                    <div class="w-3 h-3 mt-1.5 rounded-full bg-purple-500 shadow-lg shadow-purple-500/50"></div>
                    <div class="flex-1">
                        <div class="flex items-baseline gap-3 mb-1">
                            <h3 class="text-[18px] font-bold text-purple-400 font-mono">padding</h3>
                            <span class="text-[12px] text-gray-500">内边距</span>
                        </div>
                        <p class="text-gray-400 text-[14px] mb-2">内容与边框之间的透明空间</p>
                        <code class="inline-block px-3 py-1 bg-slate-800/80 rounded text-[12px] text-purple-300 font-mono">padding: 16px;</code>
                    </div>
                </div>
                
                <!-- Border 说明 -->
                <div class="group flex items-start gap-4 p-4 rounded-xl bg-gradient-to-r from-green-500/10 to-transparent border border-green-500/20 hover:border-green-500/40 transition-all">
                    <div class="w-3 h-3 mt-1.5 rounded-full bg-green-500 shadow-lg shadow-green-500/50"></div>
                    <div class="flex-1">
                        <div class="flex items-baseline gap-3 mb-1">
                            <h3 class="text-[18px] font-bold text-green-400 font-mono">border</h3>
                            <span class="text-[12px] text-gray-500">边框</span>
                        </div>
                        <p class="text-gray-400 text-[14px] mb-2">围绕 padding 和 content 的边界线</p>
                        <code class="inline-block px-3 py-1 bg-slate-800/80 rounded text-[12px] text-green-300 font-mono">border: 3px solid #4ade80;</code>
                    </div>
                </div>
                
                <!-- Margin 说明 -->
                <div class="group flex items-start gap-4 p-4 rounded-xl bg-gradient-to-r from-orange-500/10 to-transparent border border-orange-500/20 hover:border-orange-500/40 transition-all">
                    <div class="w-3 h-3 mt-1.5 rounded-full bg-orange-500 shadow-lg shadow-orange-500/50"></div>
                    <div class="flex-1">
                        <div class="flex items-baseline gap-3 mb-1">
                            <h3 class="text-[18px] font-bold text-orange-400 font-mono">margin</h3>
                            <span class="text-[12px] text-gray-500">外边距</span>
                        </div>
                        <p class="text-gray-400 text-[14px] mb-2">元素与其他元素之间的透明间隔</p>
                        <code class="inline-block px-3 py-1 bg-slate-800/80 rounded text-[12px] text-orange-300 font-mono">margin: 20px;</code>
                    </div>
                </div>
                
            </div>
        </div>
        
        <!-- 底部公式 -->
        <div class="pb-6 pt-4 flex justify-center">
            <div class="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-slate-800/50 border border-slate-700/50">
                <span class="text-[14px] text-gray-400 font-mono">Total Width =</span>
                <span class="text-[14px] text-orange-400 font-mono">margin</span>
                <span class="text-gray-600">+</span>
                <span class="text-[14px] text-green-400 font-mono">border</span>
                <span class="text-gray-600">+</span>
                <span class="text-[14px] text-purple-400 font-mono">padding</span>
                <span class="text-gray-600">+</span>
                <span class="text-[14px] text-cyan-400 font-mono">content</span>
                <span class="text-gray-600">+</span>
                <span class="text-[14px] text-purple-400 font-mono">padding</span>
                <span class="text-gray-600">+</span>
                <span class="text-[14px] text-green-400 font-mono">border</span>
                <span class="text-gray-600">+</span>
                <span class="text-[14px] text-orange-400 font-mono">margin</span>
            </div>
        </div>
        
    </div>
    
</div>
