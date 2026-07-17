<!-- Template: 科技风格-变体10 (Content #1582) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-black">
        
        <div class="w-full h-full flex items-center justify-center relative">
            <!-- 内容区域 -->
            <div class="w-[1350px] h-[720px] mx-auto my-[20px] p-12 flex flex-col items-center justify-center relative">
                <!-- 标题 -->
                <h2 class="text-[42px] font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-green-400 mb-12">
                    深度神经网络
                </h2>
                
                <!-- 神经网络可视化 -->
                <svg class="w-full max-w-5xl h-96" viewBox="0 0 1000 400">
                <defs>
                    <radialGradient id="nodeGrad1">
                        <stop offset="0%" style="stop-color:#00ffff;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#0080ff;stop-opacity:1" />
                    </radialGradient>
                    <radialGradient id="nodeGrad2">
                        <stop offset="0%" style="stop-color:#8b5cf6;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#ec4899;stop-opacity:1" />
                    </radialGradient>
                    <radialGradient id="nodeGrad3">
                        <stop offset="0%" style="stop-color:#10b981;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
                    </radialGradient>
                </defs>
                
                <!-- 连接线 -->
                <g opacity="0.3">
                    <line x1="100" y1="100" x2="300" y2="80" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="100" x2="300" y2="160" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="100" x2="300" y2="240" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="100" x2="300" y2="320" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="200" x2="300" y2="80" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="200" x2="300" y2="160" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="200" x2="300" y2="240" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="200" x2="300" y2="320" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="300" x2="300" y2="80" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="300" x2="300" y2="160" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="300" x2="300" y2="240" stroke="#00ffff" stroke-width="1"/>
                    <line x1="100" y1="300" x2="300" y2="320" stroke="#00ffff" stroke-width="1"/>
                    <line x1="300" y1="80" x2="500" y2="120" stroke="#8b5cf6" stroke-width="1"/>
                    <line x1="300" y1="160" x2="500" y2="200" stroke="#8b5cf6" stroke-width="1"/>
                    <line x1="300" y1="240" x2="500" y2="280" stroke="#8b5cf6" stroke-width="1"/>
                    <line x1="500" y1="120" x2="700" y2="160" stroke="#10b981" stroke-width="1"/>
                    <line x1="500" y1="200" x2="700" y2="240" stroke="#10b981" stroke-width="1"/>
                    <line x1="700" y1="160" x2="900" y2="200" stroke="#f59e0b" stroke-width="2"/>
                    <line x1="700" y1="240" x2="900" y2="200" stroke="#f59e0b" stroke-width="2"/>
                </g>
                
                <!-- 输入层节点 -->
                <circle cx="100" cy="100" r="25" fill="url(#nodeGrad1)" stroke="#00ffff" stroke-width="2"/>
                <text x="100" y="110" text-anchor="middle" fill="#fff" font-size="16" font-weight="bold">X₁</text>
                <circle cx="100" cy="200" r="25" fill="url(#nodeGrad1)" stroke="#00ffff" stroke-width="2"/>
                <text x="100" y="210" text-anchor="middle" fill="#fff" font-size="16" font-weight="bold">X₂</text>
                <circle cx="100" cy="300" r="25" fill="url(#nodeGrad1)" stroke="#00ffff" stroke-width="2"/>
                <text x="100" y="310" text-anchor="middle" fill="#fff" font-size="16" font-weight="bold">X₃</text>
                
                <!-- 隐藏层1节点 -->
                <circle cx="300" cy="80" r="20" fill="url(#nodeGrad2)" stroke="#8b5cf6" stroke-width="2"/>
                <circle cx="300" cy="160" r="20" fill="url(#nodeGrad2)" stroke="#8b5cf6" stroke-width="2"/>
                <circle cx="300" cy="240" r="20" fill="url(#nodeGrad2)" stroke="#8b5cf6" stroke-width="2"/>
                <circle cx="300" cy="320" r="20" fill="url(#nodeGrad2)" stroke="#8b5cf6" stroke-width="2"/>
                
                <!-- 隐藏层2节点 -->
                <circle cx="500" cy="120" r="20" fill="url(#nodeGrad2)" stroke="#8b5cf6" stroke-width="2"/>
                <circle cx="500" cy="200" r="20" fill="url(#nodeGrad2)" stroke="#8b5cf6" stroke-width="2"/>
                <circle cx="500" cy="280" r="20" fill="url(#nodeGrad2)" stroke="#8b5cf6" stroke-width="2"/>
                
                <!-- 隐藏层3节点 -->
                <circle cx="700" cy="160" r="20" fill="url(#nodeGrad3)" stroke="#10b981" stroke-width="2"/>
                <circle cx="700" cy="240" r="20" fill="url(#nodeGrad3)" stroke="#10b981" stroke-width="2"/>
                
                <!-- 输出层节点 -->
                <circle cx="900" cy="200" r="28" fill="#f59e0b" stroke="#fbbf24" stroke-width="3"/>
                <text x="900" y="210" text-anchor="middle" fill="#000" font-size="18" font-weight="bold">Y</text>
                
                <!-- 层标签 -->
                <text x="100" y="50" text-anchor="middle" fill="#00ffff" font-size="16">输入层</text>
                <text x="300" y="370" text-anchor="middle" fill="#8b5cf6" font-size="16">隐藏层 1</text>
                <text x="500" y="370" text-anchor="middle" fill="#8b5cf6" font-size="16">隐藏层 2</text>
                <text x="700" y="370" text-anchor="middle" fill="#10b981" font-size="16">隐藏层 3</text>
                <text x="900" y="370" text-anchor="middle" fill="#f59e0b" font-size="16">输出层</text>
                </svg>
                
                <!-- 底部统计 -->
                <div class="mt-10 flex gap-14">
                    <div class="text-center">
                        <p class="text-[32px] font-bold text-cyan-400 mb-2">3</p>
                        <p class="text-gray-400 text-[16px]">输入节点</p>
                    </div>
                    <div class="text-center">
                        <p class="text-[32px] font-bold text-purple-400 mb-2">9</p>
                        <p class="text-gray-400 text-[16px]">隐藏层节点</p>
                    </div>
                    <div class="text-center">
                        <p class="text-[32px] font-bold text-green-400 mb-2">1</p>
                        <p class="text-gray-400 text-[16px]">输出节点</p>
                    </div>
                    <div class="text-center">
                        <p class="text-[32px] font-bold text-yellow-400 mb-2">98.7%</p>
                        <p class="text-gray-400 text-[16px]">准确率</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
