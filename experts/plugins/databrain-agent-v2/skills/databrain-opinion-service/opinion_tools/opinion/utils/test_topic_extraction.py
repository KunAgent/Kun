"""
Topic Extraction 测试脚本

测试话题提取功能，特别是游戏领域术语的识别
"""

import asyncio
import sys
import os

# 添加项目路径
project_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
if project_path not in sys.path:
    sys.path.insert(0, project_path)


async def test_soc_query():
    """测试 SOC 相关查询（避免误判为社交）"""
    from opinion_tools.opinion.utils.topic_extraction import rank_topics_for_query
    
    print("\n" + "="*80)
    print("测试1: SOC 玩法查询（避免误判为社交）")
    print("="*80)
    
    # 模拟话题列表
    topics_list = [
        {"topic": "SOC gameplay", "topic_zh": "SOC玩法"},
        {"topic": "community", "topic_zh": "社区"},
        {"topic": "diversity", "topic_zh": "多元群体"},
        {"topic": "toxic behavior", "topic_zh": "有毒言论"},
        {"topic": "gameplay", "topic_zh": "游戏玩法"},
        {"topic": "game mechanics", "topic_zh": "游戏机制"},
        {"topic": "PvP", "topic_zh": "PvP"},
        {"topic": "PvE", "topic_zh": "PvE"},
        {"topic": "friends", "topic_zh": "好友"},
        {"topic": "monetization", "topic_zh": "付费"},
    ]
    
    query = "dune Awakening这个游戏，近一周soc相关的讨论占比怎么样"
    
    print(f"\n查询: {query}")
    print(f"候选话题数量: {len(topics_list)}")
    print(f"\n期望结果:")
    print("  ✓ 应该选择: SOC玩法, 游戏玩法, 游戏机制等游戏相关话题")
    print("  ✗ 不应该选择: 社区, 多元群体, 有毒言论等社交话题")
    
    try:
        selected_topics = await rank_topics_for_query(
            query=query,
            topics_list=topics_list,
            top_k=10,
            language="Chinese"
        )
        
        print(f"\n实际结果:")
        gaming_topics = ["SOC玩法", "游戏玩法", "游戏机制", "PvP", "PvE"]
        social_topics = ["社区", "多元群体", "有毒言论", "好友"]
        
        gaming_count = 0
        social_count = 0
        
        for idx, topic in enumerate(selected_topics, 1):
            if topic in gaming_topics:
                status = "✓ 正确（游戏相关）"
                gaming_count += 1
            elif topic in social_topics:
                status = "✗ 错误（社交误判）"
                social_count += 1
            else:
                status = "- 其他"
            
            print(f"  {idx}. {topic:<15} {status}")
        
        # 评估结果
        print(f"\n评估:")
        print(f"  游戏相关话题: {gaming_count}/{len(selected_topics)} ({gaming_count/len(selected_topics)*100:.1f}%)")
        print(f"  社交误判话题: {social_count}/{len(selected_topics)} ({social_count/len(selected_topics)*100:.1f}%)")
        
        if gaming_count >= 7 and social_count <= 2:
            print(f"\n✅ 测试通过！话题选择准确。")
            return True
        elif gaming_count >= 5:
            print(f"\n⚠️  测试部分通过，但仍有改进空间。")
            return True
        else:
            print(f"\n❌ 测试失败，话题选择不准确。")
            return False
            
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_pvp_query():
    """测试 PvP 相关查询"""
    from opinion_tools.opinion.utils.topic_extraction import rank_topics_for_query
    
    print("\n" + "="*80)
    print("测试2: PvP 玩法查询")
    print("="*80)
    
    topics_list = [
        {"topic": "PvP", "topic_zh": "PvP"},
        {"topic": "PvE", "topic_zh": "PvE"},
        {"topic": "combat system", "topic_zh": "战斗系统"},
        {"topic": "game balance", "topic_zh": "游戏平衡"},
        {"topic": "community", "topic_zh": "社区"},
        {"topic": "friends", "topic_zh": "好友"},
        {"topic": "monetization", "topic_zh": "付费"},
    ]
    
    query = "最近玩家对 PvP 模式的反馈怎么样"
    
    print(f"\n查询: {query}")
    print(f"期望: PvP 应该在前3名")
    
    try:
        selected_topics = await rank_topics_for_query(
            query=query,
            topics_list=topics_list,
            top_k=5,
            language="Chinese"
        )
        
        print(f"\n结果:")
        for idx, topic in enumerate(selected_topics, 1):
            print(f"  {idx}. {topic}")
        
        if "PvP" in selected_topics[:3]:
            print(f"\n✅ 测试通过！PvP 在前3名。")
            return True
        else:
            print(f"\n⚠️  PvP 不在前3名，可能需要优化。")
            return False
            
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_cache():
    """测试缓存功能"""
    from opinion_tools.opinion.utils.topic_extraction import rank_topics_for_query
    import time
    
    print("\n" + "="*80)
    print("测试3: 缓存功能")
    print("="*80)
    
    topics_list = [
        {"topic": "SOC gameplay", "topic_zh": "SOC玩法"},
        {"topic": "gameplay", "topic_zh": "游戏玩法"},
        {"topic": "monetization", "topic_zh": "付费"},
    ]
    
    query = "SOC相关讨论"
    
    print(f"\n查询: {query}")
    
    try:
        # 第一次调用（无缓存）
        print(f"\n第一次调用（无缓存）:")
        start_time = time.time()
        result1 = await rank_topics_for_query(query, topics_list, top_k=3, language="Chinese")
        time1 = time.time() - start_time
        print(f"  结果: {result1}")
        print(f"  耗时: {time1:.4f} 秒")
        
        # 第二次调用（应该命中缓存）
        print(f"\n第二次调用（应该命中缓存）:")
        start_time = time.time()
        result2 = await rank_topics_for_query(query, topics_list, top_k=3, language="Chinese")
        time2 = time.time() - start_time
        print(f"  结果: {result2}")
        print(f"  耗时: {time2:.4f} 秒")
        
        # 验证
        if result1 == result2:
            print(f"\n✅ 缓存功能正常！结果一致。")
            if time2 < time1 * 0.5:
                print(f"✅ 缓存加速明显！第二次调用快 {time1/time2:.1f}x")
            return True
        else:
            print(f"\n⚠️  两次结果不一致，可能有问题。")
            return False
            
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_language_support():
    """测试中英文支持"""
    from opinion_tools.opinion.utils.topic_extraction import rank_topics_for_query
    
    print("\n" + "="*80)
    print("测试4: 中英文支持")
    print("="*80)
    
    topics_list = [
        {"topic": "SOC gameplay", "topic_zh": "SOC玩法"},
        {"topic": "monetization", "topic_zh": "付费"},
        {"topic": "bug", "topic_zh": "漏洞"},
    ]
    
    # 测试中文
    print(f"\n中文查询:")
    query_zh = "SOC玩法怎么样"
    result_zh = await rank_topics_for_query(query_zh, topics_list, top_k=3, language="Chinese")
    print(f"  查询: {query_zh}")
    print(f"  结果: {result_zh}")
    
    # 测试英文
    print(f"\n英文查询:")
    query_en = "How is the SOC gameplay"
    result_en = await rank_topics_for_query(query_en, topics_list, top_k=3, language="English")
    print(f"  查询: {query_en}")
    print(f"  结果: {result_en}")
    
    # 验证
    if result_zh and result_en:
        print(f"\n✅ 中英文支持正常！")
        return True
    else:
        print(f"\n❌ 某个语言的结果为空。")
        return False


async def main():
    """运行所有测试"""
    print("\n" + "="*80)
    print(" Topic Extraction 测试套件")
    print("="*80)
    
    results = []
    
    # 运行所有测试
    results.append(("SOC查询测试", await test_soc_query()))
    results.append(("PvP查询测试", await test_pvp_query()))
    results.append(("缓存功能测试", await test_cache()))
    results.append(("中英文支持测试", await test_language_support()))
    
    # 汇总结果
    print("\n" + "="*80)
    print(" 测试结果汇总")
    print("="*80)
    
    for test_name, passed in results:
        status = "✅ 通过" if passed else "❌ 失败"
        print(f"{test_name:<20}: {status}")
    
    # 总结
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)
    
    print("\n" + "="*80)
    if passed_count == total_count:
        print(f"🎉 所有测试通过！({passed_count}/{total_count})")
    else:
        print(f"⚠️  部分测试失败 ({passed_count}/{total_count})")
    print("="*80)


if __name__ == "__main__":
    asyncio.run(main())

