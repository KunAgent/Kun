<!-- Template: 科技风-控制台 (TOC #3583) -->
    <div class="w-[1440px] h-[810px] shadow-2xl relative overflow-hidden" style="background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%);">
        <div class="w-[1350px] h-[720px] mx-auto my-[45px] flex items-center justify-center relative">
            <!-- 控制台界面背景 -->
            <div style="position: absolute; inset: 0; opacity: 0.1; font-family: 'Courier New', monospace; font-size: 12px; color: #00ff88; line-height: 1.8; overflow: hidden;">
$ system status: ONLINE<br/>
$ modules loaded: 4<br/>
$ connection: SECURE<br/>
$ access level: ADMIN<br/>
$ monitoring: ACTIVE<br/>
            </div>

            <!-- 状态指示灯 -->
            <div style="position: absolute; top: 5%; right: 5%; display: flex; gap: 8px;">
                <div class="w-3 h-3 bg-green-400 rounded-full animate-pulse" style="box-shadow: 0 0 10px #4ade80;"></div>
                <div class="w-3 h-3 bg-blue-400 rounded-full animate-pulse" style="animation-delay: 0.3s; box-shadow: 0 0 10px #60a5fa;"></div>
                <div class="w-3 h-3 bg-amber-400 rounded-full animate-pulse" style="animation-delay: 0.6s; box-shadow: 0 0 10px #fbbf24;"></div>
            </div>

            <div class="max-w-5xl w-full relative z-10">
                <div class="mb-10">
                    <h1 class="text-5xl font-bold mb-4 text-green-400" style="font-family: 'Courier New', monospace; text-shadow: 0 0 20px rgba(74, 222, 128, 0.6);">
                        &gt; COMMAND CENTER_
                    </h1>
                    <div class="flex gap-2">
                        <div style="width: 60px; height: 3px; background: linear-gradient(to right, #4ade80, transparent);"></div>
                        <div style="width: 8px; height: 3px; background: #4ade80; animation: blink 1.5s infinite;"></div>
                    </div>
                </div>
                
                <!-- 2x2网格布局带间距 -->
                <div class="grid grid-cols-2 gap-x-8 gap-y-6">
                    
                    <div class="group cursor-pointer">
                        <div style="position: relative; padding: 22px; background: rgba(74, 222, 128, 0.05); border: 2px solid #4ade80; font-family: 'Courier New', monospace; transition: all 0.3s;">
                            <!-- 状态栏 -->
                            <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(to right, #4ade80, #60a5fa); opacity: 0.6;"></div>
                            
                            <div class="flex items-start gap-4 mb-3">
                                <div style="width: 55px; height: 55px; background: rgba(74, 222, 128, 0.15); border: 2px solid #4ade80; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                    <span class="text-2xl font-bold text-green-400">1</span>
                                </div>
                                <div style="flex: 1;">
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #4ade80 0px, #4ade80 6px, transparent 6px, transparent 10px); margin-bottom: 6px;"></div>
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #60a5fa 0px, #60a5fa 4px, transparent 4px, transparent 8px);"></div>
                                </div>
                                <div class="w-3 h-3 bg-green-400" style="box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                            <h3 class="text-lg font-bold text-green-400 mb-2">&gt; 项目背景</h3>
                            <p class="text-blue-300 text-sm opacity-80">// 了解项目的起源与目标</p>
                            
                            <!-- 进度条装饰 -->
                            <div style="position: absolute; bottom: 10px; left: 22px; right: 22px; height: 2px; background: rgba(74, 222, 128, 0.3);">
                                <div style="width: 60%; height: 100%; background: #4ade80; box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="group cursor-pointer">
                        <div style="position: relative; padding: 22px; background: rgba(74, 222, 128, 0.05); border: 2px solid #4ade80; font-family: 'Courier New', monospace; transition: all 0.3s;">
                            <!-- 状态栏 -->
                            <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(to right, #4ade80, #60a5fa); opacity: 0.6;"></div>
                            
                            <div class="flex items-start gap-4 mb-3">
                                <div style="width: 55px; height: 55px; background: rgba(74, 222, 128, 0.15); border: 2px solid #4ade80; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                    <span class="text-2xl font-bold text-green-400">2</span>
                                </div>
                                <div style="flex: 1;">
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #4ade80 0px, #4ade80 6px, transparent 6px, transparent 10px); margin-bottom: 6px;"></div>
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #60a5fa 0px, #60a5fa 4px, transparent 4px, transparent 8px);"></div>
                                </div>
                                <div class="w-3 h-3 bg-green-400" style="box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                            <h3 class="text-lg font-bold text-green-400 mb-2">&gt; 核心功能</h3>
                            <p class="text-blue-300 text-sm opacity-80">// 产品的主要功能介绍</p>
                            
                            <!-- 进度条装饰 -->
                            <div style="position: absolute; bottom: 10px; left: 22px; right: 22px; height: 2px; background: rgba(74, 222, 128, 0.3);">
                                <div style="width: 60%; height: 100%; background: #4ade80; box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="group cursor-pointer">
                        <div style="position: relative; padding: 22px; background: rgba(74, 222, 128, 0.05); border: 2px solid #4ade80; font-family: 'Courier New', monospace; transition: all 0.3s;">
                            <!-- 状态栏 -->
                            <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(to right, #4ade80, #60a5fa); opacity: 0.6;"></div>
                            
                            <div class="flex items-start gap-4 mb-3">
                                <div style="width: 55px; height: 55px; background: rgba(74, 222, 128, 0.15); border: 2px solid #4ade80; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                    <span class="text-2xl font-bold text-green-400">3</span>
                                </div>
                                <div style="flex: 1;">
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #4ade80 0px, #4ade80 6px, transparent 6px, transparent 10px); margin-bottom: 6px;"></div>
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #60a5fa 0px, #60a5fa 4px, transparent 4px, transparent 8px);"></div>
                                </div>
                                <div class="w-3 h-3 bg-green-400" style="box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                            <h3 class="text-lg font-bold text-green-400 mb-2">&gt; 技术架构</h3>
                            <p class="text-blue-300 text-sm opacity-80">// 系统设计与技术选型</p>
                            
                            <!-- 进度条装饰 -->
                            <div style="position: absolute; bottom: 10px; left: 22px; right: 22px; height: 2px; background: rgba(74, 222, 128, 0.3);">
                                <div style="width: 60%; height: 100%; background: #4ade80; box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="group cursor-pointer">
                        <div style="position: relative; padding: 22px; background: rgba(74, 222, 128, 0.05); border: 2px solid #4ade80; font-family: 'Courier New', monospace; transition: all 0.3s;">
                            <!-- 状态栏 -->
                            <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(to right, #4ade80, #60a5fa); opacity: 0.6;"></div>
                            
                            <div class="flex items-start gap-4 mb-3">
                                <div style="width: 55px; height: 55px; background: rgba(74, 222, 128, 0.15); border: 2px solid #4ade80; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                    <span class="text-2xl font-bold text-green-400">4</span>
                                </div>
                                <div style="flex: 1;">
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #4ade80 0px, #4ade80 6px, transparent 6px, transparent 10px); margin-bottom: 6px;"></div>
                                    <div style="height: 2px; background: repeating-linear-gradient(to right, #60a5fa 0px, #60a5fa 4px, transparent 4px, transparent 8px);"></div>
                                </div>
                                <div class="w-3 h-3 bg-green-400" style="box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                            <h3 class="text-lg font-bold text-green-400 mb-2">&gt; 实施计划</h3>
                            <p class="text-blue-300 text-sm opacity-80">// 项目的推进与时间安排</p>
                            
                            <!-- 进度条装饰 -->
                            <div style="position: absolute; bottom: 10px; left: 22px; right: 22px; height: 2px; background: rgba(74, 222, 128, 0.3);">
                                <div style="width: 60%; height: 100%; background: #4ade80; box-shadow: 0 0 8px #4ade80;"></div>
                            </div>
                        </div>
                    </div>
                    
                </div>
            </div>
        </div>
    </div>

    <style>
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
    </style>
