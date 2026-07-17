<!-- Template: 科技风格-变体5 (Content #1577) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-black">
        
        <!-- 网格背景 -->
        <div class="absolute inset-0 opacity-10" style="background-image: 
            repeating-linear-gradient(0deg, transparent, transparent 40px, #00ffff 40px, #00ffff 41px),
            repeating-linear-gradient(90deg, transparent, transparent 40px, #00ffff 40px, #00ffff 41px);">
        </div>
        
        <div class="w-full h-full flex items-center justify-center relative">
            <!-- 内容区域 -->
            <div class="w-[1350px] h-[720px] mx-auto my-[20px] p-12 flex flex-col items-center justify-center relative perspective-1000">
                <!-- 标题 -->
                <h2 class="text-[42px] font-bold text-cyan-400 mb-16 relative z-10">
                    立体数据矩阵
                </h2>
                
                <!-- 3D立方体矩阵 -->
                <div class="relative w-full max-w-5xl" style="transform-style: preserve-3d; perspective: 1200px;">
                    <div class="flex justify-center items-center gap-14">
                        <!-- 立方体1 -->
                        <div class="relative w-52 h-52" style="transform-style: preserve-3d; transform: rotateX(-15deg) rotateY(-25deg);">
                            <!-- 前面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-cyan-500/80 to-blue-600/80 border-2 border-cyan-400 flex items-center justify-center"
                                 style="transform: translateZ(104px);">
                                <div class="text-center">
                                    <div class="text-[38px] mb-3">🔵</div>
                                    <p class="text-white font-bold text-[22px]">Layer 1</p>
                                    <p class="text-cyan-200 text-[16px] mt-2">Input</p>
                                </div>
                            </div>
                            
                            <!-- 右面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-cyan-600/60 to-blue-700/60 border-2 border-cyan-500"
                                 style="transform: rotateY(90deg) translateZ(104px);"></div>
                            
                            <!-- 顶面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-cyan-400/40 to-blue-500/40 border-2 border-cyan-600"
                                 style="transform: rotateX(90deg) translateZ(104px);"></div>
                        </div>
                        
                        <!-- 立方体2 -->
                        <div class="relative w-52 h-52" style="transform-style: preserve-3d; transform: rotateX(-15deg) rotateY(-25deg);">
                            <!-- 前面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-purple-500/80 to-pink-600/80 border-2 border-purple-400 flex items-center justify-center"
                                 style="transform: translateZ(104px);">
                                <div class="text-center">
                                    <div class="text-[38px] mb-3">🟣</div>
                                    <p class="text-white font-bold text-[22px]">Layer 2</p>
                                    <p class="text-purple-200 text-[16px] mt-2">Process</p>
                                </div>
                            </div>
                            
                            <!-- 右面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-purple-600/60 to-pink-700/60 border-2 border-purple-500"
                                 style="transform: rotateY(90deg) translateZ(104px);"></div>
                            
                            <!-- 顶面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-purple-400/40 to-pink-500/40 border-2 border-purple-600"
                                 style="transform: rotateX(90deg) translateZ(104px);"></div>
                        </div>
                        
                        <!-- 立方体3 -->
                        <div class="relative w-52 h-52" style="transform-style: preserve-3d; transform: rotateX(-15deg) rotateY(-25deg);">
                            <!-- 前面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-green-500/80 to-emerald-600/80 border-2 border-green-400 flex items-center justify-center"
                                 style="transform: translateZ(104px);">
                                <div class="text-center">
                                    <div class="text-[38px] mb-3">🟢</div>
                                    <p class="text-white font-bold text-[22px]">Layer 3</p>
                                    <p class="text-green-200 text-[16px] mt-2">Output</p>
                                </div>
                            </div>
                            
                            <!-- 右面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-green-600/60 to-emerald-700/60 border-2 border-green-500"
                                 style="transform: rotateY(90deg) translateZ(104px);"></div>
                            
                            <!-- 顶面 -->
                            <div class="absolute w-full h-full bg-gradient-to-br from-green-400/40 to-emerald-500/40 border-2 border-green-600"
                                 style="transform: rotateX(90deg) translateZ(104px);"></div>
                        </div>
                    </div>
                    
                    <!-- 连接线 -->
                    <svg class="absolute inset-0 w-full h-full pointer-events-none" style="top: 50%; transform: translateY(-50%);">
                        <defs>
                            <marker id="arrow1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                                <polygon points="0 0, 8 3, 0 6" fill="#00ffff" />
                            </marker>
                        </defs>
                        <line x1="250" y1="130" x2="390" y2="130" stroke="#00ffff" stroke-width="3" stroke-dasharray="10,5" marker-end="url(#arrow1)"/>
                        <line x1="640" y1="130" x2="780" y2="130" stroke="#00ffff" stroke-width="3" stroke-dasharray="10,5" marker-end="url(#arrow1)"/>
                    </svg>
                </div>
                
                <!-- 底部信息 -->
                <div class="mt-16 flex justify-center gap-16 relative z-10">
                    <div class="text-center">
                        <p class="text-[32px] font-bold text-cyan-400 mb-2">256</p>
                        <p class="text-gray-400 text-[16px]">Nodes</p>
                    </div>
                    <div class="text-center">
                        <p class="text-[32px] font-bold text-purple-400 mb-2">1024</p>
                        <p class="text-gray-400 text-[16px]">Connections</p>
                    </div>
                    <div class="text-center">
                        <p class="text-[32px] font-bold text-green-400 mb-2">99.9%</p>
                        <p class="text-gray-400 text-[16px]">Accuracy</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
