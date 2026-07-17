<!-- Template: 几何风格-变体5 (Content #1545) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
        <!-- 内容区域 -->
        <div class="w-[1350px] h-[720px] mx-auto my-[20px] flex flex-col items-center justify-center">
            <h2 class="text-[40px] font-bold text-white mb-4 text-center">立体架构</h2>
            <p class="text-[20px] text-indigo-200 text-center mb-8">分层架构的模块化设计</p>
            
            <!-- 三层架构布局 -->
            <div class="relative" style="width: 1000px; height: 480px;">
                <!-- 连接线 SVG -->
                <svg class="absolute inset-0 w-full h-full" viewBox="0 0 1000 480" style="z-index: 0;">
                    <!-- 顶层到中间层的连接 -->
                    <line x1="500" y1="95" x2="300" y2="195" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <line x1="500" y1="95" x2="500" y2="195" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <line x1="500" y1="95" x2="700" y2="195" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <!-- 中间层到底层的连接 -->
                    <line x1="300" y1="275" x2="250" y2="345" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <line x1="300" y1="275" x2="417" y2="345" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <line x1="500" y1="275" x2="417" y2="345" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <line x1="500" y1="275" x2="583" y2="345" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <line x1="700" y1="275" x2="583" y2="345" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                    <line x1="700" y1="275" x2="750" y2="345" stroke="#6366f1" stroke-width="2" stroke-dasharray="6,4" opacity="0.5"/>
                </svg>
                
                <!-- 顶层 - 前端应用层 -->
                <div class="absolute left-1/2 transform -translate-x-1/2" style="top: 0; z-index: 3;">
                    <div class="w-56 h-24 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg border-2 border-cyan-300/30">
                        <div class="text-center text-white">
                            <div class="text-[20px] font-bold">前端应用层</div>
                            <div class="text-[14px] opacity-80">Web / Mobile / Desktop</div>
                        </div>
                    </div>
                </div>
                
                <!-- 中间层 - 业务服务 -->
                <div class="absolute" style="top: 155px; left: 150px; z-index: 2;">
                    <div class="w-48 h-28 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg border-2 border-rose-300/30">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">用户服务</div>
                            <div class="text-[13px] opacity-80">认证 / 权限</div>
                        </div>
                    </div>
                </div>
                
                <div class="absolute" style="top: 155px; left: 406px; z-index: 2;">
                    <div class="w-48 h-28 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg border-2 border-emerald-300/30">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">业务逻辑层</div>
                            <div class="text-[13px] opacity-80">核心业务处理</div>
                        </div>
                    </div>
                </div>
                
                <div class="absolute" style="top: 155px; left: 662px; z-index: 2;">
                    <div class="w-48 h-28 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg border-2 border-amber-300/30">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">API网关</div>
                            <div class="text-[13px] opacity-80">路由 / 限流</div>
                        </div>
                    </div>
                </div>
                
                <!-- 底层 - 数据存储 -->
                <div class="absolute" style="top: 335px; left: 100px; z-index: 1;">
                    <div class="w-44 h-24 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg border-2 border-blue-300/30">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">数据库</div>
                            <div class="text-[13px] opacity-80">MySQL / PostgreSQL</div>
                        </div>
                    </div>
                </div>
                
                <div class="absolute" style="top: 335px; left: 333px; z-index: 1;">
                    <div class="w-44 h-24 rounded-xl bg-gradient-to-br from-purple-600 to-violet-700 flex items-center justify-center shadow-lg border-2 border-purple-300/30">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">缓存</div>
                            <div class="text-[13px] opacity-80">Redis / Memcached</div>
                        </div>
                    </div>
                </div>
                
                <div class="absolute" style="top: 335px; left: 523px; z-index: 1;">
                    <div class="w-44 h-24 rounded-xl bg-gradient-to-br from-fuchsia-600 to-pink-700 flex items-center justify-center shadow-lg border-2 border-fuchsia-300/30">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">消息队列</div>
                            <div class="text-[13px] opacity-80">Kafka / RabbitMQ</div>
                        </div>
                    </div>
                </div>
                
                <div class="absolute" style="top: 335px; left: 713px; z-index: 1;">
                    <div class="w-44 h-24 rounded-xl bg-gradient-to-br from-teal-600 to-cyan-700 flex items-center justify-center shadow-lg border-2 border-teal-300/30">
                        <div class="text-center text-white">
                            <div class="text-[18px] font-bold">存储服务</div>
                            <div class="text-[13px] opacity-80">OSS / MinIO</div>
                        </div>
                    </div>
                </div>
                
                <!-- 层级标签 -->
                <div class="absolute left-0 top-8 text-indigo-300 text-[14px] font-medium">表现层</div>
                <div class="absolute left-0 top-44 text-indigo-300 text-[14px] font-medium">服务层</div>
                <div class="absolute left-0 top-96 text-indigo-300 text-[14px] font-medium">数据层</div>
            </div>
        </div>
    </div>
