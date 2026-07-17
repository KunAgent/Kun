<!-- 
模板ID: 3531
模板名称: 中国风-卷轴式
适用场景: 传统书卷风格目录页
设计特点: 水墨画卷,雅致配色,现代排版
-->
<div class="w-[1440px] h-[810px] relative overflow-hidden" style="background: linear-gradient(135deg, #f5f1e8 0%, #ede4d3 50%, #f5f1e8 100%);">
  <!-- 水墨渲染背景 -->
  <div class="absolute top-0 right-0 w-96 h-96 opacity-10" style="background: radial-gradient(circle, #8b4513 0%, transparent 70%);"></div>
  <div class="absolute bottom-0 left-0 w-80 h-80 opacity-10" style="background: radial-gradient(circle, #8b4513 0%, transparent 70%);"></div>
  
  <!-- 竹简装饰元素 -->
  <div class="absolute left-0 top-1/2 transform -translate-y-1/2 w-1 h-[600px] bg-gradient-to-b from-transparent via-amber-800/20 to-transparent"></div>
  <div class="absolute right-0 top-1/2 transform -translate-y-1/2 w-1 h-[600px] bg-gradient-to-b from-transparent via-amber-800/20 to-transparent"></div>

  <div class="w-full h-full flex items-center justify-center px-24 py-16">
    <div class="w-full max-w-6xl">
      <!-- 顶部标题区 -->
      <div class="text-center mb-16 relative">
        <!-- 印章装饰 -->
        <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 w-20 h-20 border-4 border-red-700 rotate-45 opacity-20"></div>
        
        <div class="inline-block relative">
          <h1 class="text-6xl font-serif text-gray-900 tracking-widest relative z-10" style="font-family: 'KaiTi', 'STKaiti', serif;">
            目录
          </h1>
          <div class="absolute -bottom-3 left-1/2 transform -translate-x-1/2 w-32 h-1 bg-gradient-to-r from-transparent via-red-700 to-transparent"></div>
        </div>
        
        <!-- 副标题装饰线 -->
        <div class="mt-8 flex items-center justify-center gap-3">
          <div class="w-12 h-px bg-gradient-to-r from-transparent to-amber-700"></div>
          <div class="flex gap-1">
            <div class="w-1.5 h-1.5 bg-red-700 rounded-full"></div>
            <div class="w-1.5 h-1.5 bg-red-700 rounded-full"></div>
            <div class="w-1.5 h-1.5 bg-red-700 rounded-full"></div>
          </div>
          <div class="w-12 h-px bg-gradient-to-l from-transparent to-amber-700"></div>
        </div>
      </div>

      <!-- 章节列表容器 -->
      <div class="relative">
        <!-- 左侧竖向装饰 -->
        <div class="absolute -left-12 top-0 bottom-0 w-8 flex flex-col justify-center gap-12">
          <div class="w-2 h-2 bg-red-700 rounded-full mx-auto"></div>
          <div class="w-2 h-2 bg-red-700 rounded-full mx-auto"></div>
          <div class="w-2 h-2 bg-red-700 rounded-full mx-auto"></div>
        </div>

        <!-- 章节网格 -->
        <div class="grid grid-cols-2 gap-x-16 gap-y-6">
          
          <div class="group relative">
            <!-- 章节卡片 -->
            <div class="flex items-center gap-5 p-5 rounded-xl transition-all duration-500 hover:translate-x-2" style="background: linear-gradient(120deg, rgba(255,255,255,0.6) 0%, rgba(255,251,235,0.8) 100%); box-shadow: 0 2px 8px rgba(139,69,19,0.08);">
              <!-- 章节序号 -->
              <div class="relative flex-shrink-0">
                <div class="w-14 h-14 flex items-center justify-center relative">
                  <!-- 外圈装饰 -->
                  <div class="absolute inset-0 border-2 border-red-700 rounded-full opacity-0 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"></div>
                  <!-- 序号背景 -->
                  <div class="w-12 h-12 rounded-full flex items-center justify-center relative z-10" style="background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%);">
                    <span class="text-amber-100 text-xl font-bold" style="font-family: 'KaiTi', 'STKaiti', serif;">1</span>
                  </div>
                </div>
              </div>

              <!-- 章节标题 -->
              <div class="flex-1 min-w-0">
                <h3 class="text-xl text-gray-800 font-medium leading-relaxed group-hover:text-red-900 transition-colors duration-300 truncate" style="font-family: 'KaiTi', 'STKaiti', serif;">
                  项目背景
                </h3>
              </div>

              <!-- 右侧箭头 -->
              <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                <svg class="w-5 h-5 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
              </div>
            </div>

            <!-- 悬浮时的底部线条 -->
            <div class="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-red-700 to-amber-700 group-hover:w-full transition-all duration-500"></div>
          </div>
          
          <div class="group relative">
            <!-- 章节卡片 -->
            <div class="flex items-center gap-5 p-5 rounded-xl transition-all duration-500 hover:translate-x-2" style="background: linear-gradient(120deg, rgba(255,255,255,0.6) 0%, rgba(255,251,235,0.8) 100%); box-shadow: 0 2px 8px rgba(139,69,19,0.08);">
              <!-- 章节序号 -->
              <div class="relative flex-shrink-0">
                <div class="w-14 h-14 flex items-center justify-center relative">
                  <!-- 外圈装饰 -->
                  <div class="absolute inset-0 border-2 border-red-700 rounded-full opacity-0 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"></div>
                  <!-- 序号背景 -->
                  <div class="w-12 h-12 rounded-full flex items-center justify-center relative z-10" style="background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%);">
                    <span class="text-amber-100 text-xl font-bold" style="font-family: 'KaiTi', 'STKaiti', serif;">2</span>
                  </div>
                </div>
              </div>

              <!-- 章节标题 -->
              <div class="flex-1 min-w-0">
                <h3 class="text-xl text-gray-800 font-medium leading-relaxed group-hover:text-red-900 transition-colors duration-300 truncate" style="font-family: 'KaiTi', 'STKaiti', serif;">
                  核心功能
                </h3>
              </div>

              <!-- 右侧箭头 -->
              <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                <svg class="w-5 h-5 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
              </div>
            </div>

            <!-- 悬浮时的底部线条 -->
            <div class="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-red-700 to-amber-700 group-hover:w-full transition-all duration-500"></div>
          </div>
          
          <div class="group relative">
            <!-- 章节卡片 -->
            <div class="flex items-center gap-5 p-5 rounded-xl transition-all duration-500 hover:translate-x-2" style="background: linear-gradient(120deg, rgba(255,255,255,0.6) 0%, rgba(255,251,235,0.8) 100%); box-shadow: 0 2px 8px rgba(139,69,19,0.08);">
              <!-- 章节序号 -->
              <div class="relative flex-shrink-0">
                <div class="w-14 h-14 flex items-center justify-center relative">
                  <!-- 外圈装饰 -->
                  <div class="absolute inset-0 border-2 border-red-700 rounded-full opacity-0 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"></div>
                  <!-- 序号背景 -->
                  <div class="w-12 h-12 rounded-full flex items-center justify-center relative z-10" style="background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%);">
                    <span class="text-amber-100 text-xl font-bold" style="font-family: 'KaiTi', 'STKaiti', serif;">3</span>
                  </div>
                </div>
              </div>

              <!-- 章节标题 -->
              <div class="flex-1 min-w-0">
                <h3 class="text-xl text-gray-800 font-medium leading-relaxed group-hover:text-red-900 transition-colors duration-300 truncate" style="font-family: 'KaiTi', 'STKaiti', serif;">
                  技术架构
                </h3>
              </div>

              <!-- 右侧箭头 -->
              <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                <svg class="w-5 h-5 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
              </div>
            </div>

            <!-- 悬浮时的底部线条 -->
            <div class="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-red-700 to-amber-700 group-hover:w-full transition-all duration-500"></div>
          </div>
          
          <div class="group relative">
            <!-- 章节卡片 -->
            <div class="flex items-center gap-5 p-5 rounded-xl transition-all duration-500 hover:translate-x-2" style="background: linear-gradient(120deg, rgba(255,255,255,0.6) 0%, rgba(255,251,235,0.8) 100%); box-shadow: 0 2px 8px rgba(139,69,19,0.08);">
              <!-- 章节序号 -->
              <div class="relative flex-shrink-0">
                <div class="w-14 h-14 flex items-center justify-center relative">
                  <!-- 外圈装饰 -->
                  <div class="absolute inset-0 border-2 border-red-700 rounded-full opacity-0 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"></div>
                  <!-- 序号背景 -->
                  <div class="w-12 h-12 rounded-full flex items-center justify-center relative z-10" style="background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%);">
                    <span class="text-amber-100 text-xl font-bold" style="font-family: 'KaiTi', 'STKaiti', serif;">4</span>
                  </div>
                </div>
              </div>

              <!-- 章节标题 -->
              <div class="flex-1 min-w-0">
                <h3 class="text-xl text-gray-800 font-medium leading-relaxed group-hover:text-red-900 transition-colors duration-300 truncate" style="font-family: 'KaiTi', 'STKaiti', serif;">
                  实施计划
                </h3>
              </div>

              <!-- 右侧箭头 -->
              <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                <svg class="w-5 h-5 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
              </div>
            </div>

            <!-- 悬浮时的底部线条 -->
            <div class="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-red-700 to-amber-700 group-hover:w-full transition-all duration-500"></div>
          </div>
          
        </div>

        <!-- 右侧竖向装饰 -->
        <div class="absolute -right-12 top-0 bottom-0 w-8 flex flex-col justify-center gap-12">
          <div class="w-2 h-2 bg-red-700 rounded-full mx-auto"></div>
          <div class="w-2 h-2 bg-red-700 rounded-full mx-auto"></div>
          <div class="w-2 h-2 bg-red-700 rounded-full mx-auto"></div>
        </div>
      </div>

      <!-- 底部印章装饰 -->
      <div class="mt-12 flex justify-center">
        <div class="w-16 h-16 border-3 border-red-700 rounded-sm rotate-45 flex items-center justify-center opacity-40">
          <div class="w-8 h-8 bg-red-700 rounded-sm -rotate-45"></div>
        </div>
      </div>
    </div>
  </div>
</div>
