#!/usr/bin/env python3
"""
章节正文生成器

根据章节大纲、风格配置和角色档案，构建 LLM 提示词并生成章节正文。
"""

import argparse
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from rich.text import Text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

console = Console()


class NovelWriterError(Exception):
    """自定义异常类"""

    pass


class ChapterWriter:
    """章节正文生成器核心类"""

    def __init__(
        self,
        book_dir: Path,
        chapter: str,
        outline: str,
        word_count: Optional[int] = None,
        temperature: float = 0.7,
    ):
        self.book_dir = Path(book_dir).resolve()
        self.chapter = chapter
        self.outline = outline
        self.word_count = word_count or 2000
        self.temperature = temperature

        self.style_config: Dict[str, Any] = {}
        self.characters: Dict[str, Dict[str, Any]] = {}
        self.outline_data: Dict[str, Any] = {}

        self._validate_directories()

    def _validate_directories(self) -> None:
        """验证目录结构"""
        if not self.book_dir.exists():
            raise NovelWriterError(f"书籍目录不存在: {self.book_dir}")

        style_path = self.book_dir / "style.yml"
        if not style_path.exists():
            logger.warning(f"风格配置文件不存在: {style_path}，使用默认配置")

        characters_dir = self.book_dir / "characters"
        if not characters_dir.exists():
            logger.warning(f"角色目录不存在: {characters_dir}")

        outline_path = self.book_dir / self.outline
        if not outline_path.exists():
            raise NovelWriterError(f"大纲文件不存在: {outline_path}")

    def load_style_config(self) -> None:
        """加载风格配置"""
        style_path = self.book_dir / "style.yml"
        if not style_path.exists():
            logger.warning(f"风格配置文件不存在: {style_path}，使用空配置")
            return

        for encoding in ["utf-8", "gbk"]:
            try:
                with open(style_path, "r", encoding=encoding) as f:
                    self.style_config = yaml.safe_load(f)
                console.print(f"[green]✓[/green] 加载风格配置: {style_path}")
                return
            except UnicodeDecodeError:
                continue
            except yaml.YAMLError as e:
                raise NovelWriterError(f"解析风格配置失败: {e}")

        raise NovelWriterError(f"无法读取风格配置文件: {style_path}")

    def load_characters(self) -> None:
        """加载角色档案"""
        characters_dir = self.book_dir / "characters"
        if not characters_dir.exists():
            console.print("[yellow]⚠[/yellow] 角色目录不存在，跳过角色加载")
            return

        for yml_file in characters_dir.glob("*.yml"):
            for encoding in ["utf-8", "gbk"]:
                try:
                    with open(yml_file, "r", encoding=encoding) as f:
                        data = yaml.safe_load(f)
                        char_name = data.get("name", yml_file.stem)
                        self.characters[char_name] = data
                    console.print(f"[green]✓[/green] 加载角色: {char_name}")
                    break
                except UnicodeDecodeError:
                    continue
                except yaml.YAMLError as e:
                    logger.warning(f"解析角色文件失败 {yml_file}: {e}")
                    break

    def load_outline(self) -> None:
        """加载章节大纲"""
        outline_path = self.book_dir / self.outline
        for encoding in ["utf-8", "gbk"]:
            try:
                with open(outline_path, "r", encoding=encoding) as f:
                    content = f.read()
                    self.outline_data = {
                        "raw": content,
                        "chapter": self.chapter,
                        "timestamp": datetime.now().isoformat(),
                    }
                console.print(f"[green]✓[/green] 加载大纲: {outline_path}")
                return
            except UnicodeDecodeError:
                continue
            except Exception as e:
                raise NovelWriterError(f"读取大纲文件失败: {e}")

        raise NovelWriterError(f"无法读取大纲文件: {outline_path}")

    def build_system_prompt(self) -> str:
        """构建系统提示词"""
        system_parts = [
            "# 小说写作助手",
            "",
            "## 角色",
            "你是一位专业的小说作家，擅长根据提供的大纲、风格和角色信息创作高质量的小说章节。",
            "",
        ]

        if self.style_config:
            system_parts.extend(
                [
                    "## 写作风格",
                    "",
                    "请遵循以下风格要求：",
                    "",
                ]
            )
            voice_profile = self.style_config.get("voice_profile", {})
            if voice_profile:
                for key, value in voice_profile.items():
                    system_parts.append(f"- **{key}:** {value}")
            else:
                for key, value in self.style_config.items():
                    system_parts.append(f"- **{key}:** {value}")
            system_parts.append("")

        if self.characters:
            system_parts.extend(
                [
                    "## 角色档案",
                    "",
                    "请确保角色行为与以下档案一致：",
                    "",
                ]
            )
            for name, char_data in self.characters.items():
                system_parts.append(f"### {name}")
                if char_data.get("description"):
                    system_parts.append(f"描述: {char_data['description']}")
                if char_data.get("personality"):
                    system_parts.append(f"性格: {char_data['personality']}")
                system_parts.append("")

        system_parts.extend(
            [
                "## 写作要求",
                "",
                "- 严格遵循提供的章节大纲",
                "- 保持风格一致性",
                "- 角色行为符合其档案设定",
                "- 输出 Markdown 格式",
                "- 控制字数在目标范围内",
                "- 使用生动的语言和详细的描写",
                "",
            ]
        )

        return "\n".join(system_parts)

    def build_user_prompt(self) -> str:
        """构建用户提示词"""
        user_parts = [
            f"请根据以下信息创作第 {self.chapter} 章正文：",
            "",
            "## 章节大纲",
            "",
            self.outline_data["raw"],
            "",
        ]

        user_parts.extend(
            [
                "## 写作参数",
                "",
                f"- **字数目标:** {self.word_count} 字",
                f"- **风格温度:** {self.temperature}",
                "",
            ]
        )

        return "\n".join(user_parts)

    def build_markdown_output(self) -> str:
        """构建 Markdown 格式的提示词文件"""
        metadata = Table(show_header=False, box=None)
        metadata.add_row("书籍目录", str(self.book_dir))
        metadata.add_row("章节编号", self.chapter)
        metadata.add_row("大纲文件", self.outline)
        metadata.add_row("字数目标", str(self.word_count))
        metadata.add_row("温度设置", str(self.temperature))
        metadata.add_row("生成时间", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

        markdown_parts = [
            "# LLM 提示词配置",
            "",
            "## 元数据",
            "",
            metadata.__str__(),
            "",
            "---",
            "",
            "## 系统提示词",
            "",
            "```markdown",
            self.build_system_prompt(),
            "```",
            "",
            "---",
            "",
            "## 用户提示词",
            "",
            "```markdown",
            self.build_user_prompt(),
            "```",
            "",
            "---",
            "",
            "## 使用说明",
            "",
            "1. 将 '系统提示词' 和 '用户提示词' 发送给 LLM",
            f"2. 建议使用 temperature: {self.temperature}",
            "3. 输出格式应为 Markdown",
            "",
        ]

        return "\n".join(markdown_parts)

    def write_output(self, output_path: Path) -> None:
        """写入输出文件"""
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            content = self.build_markdown_output()
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(content)
            console.print(f"[green]✓[/green] 输出文件: {output_path}")
        except Exception as e:
            raise NovelWriterError(f"写入输出文件失败: {e}")

    def display_summary(self) -> None:
        """显示配置摘要"""
        panel = Panel(
            Text.assemble(
                ("书籍目录: ", "bold cyan"),
                (str(self.book_dir), "cyan"),
                "\n",
                ("章节: ", "bold cyan"),
                (self.chapter, "cyan"),
                "\n",
                ("大纲: ", "bold cyan"),
                (self.outline, "cyan"),
                "\n",
                ("字数目标: ", "bold cyan"),
                (str(self.word_count), "cyan"),
                "\n",
                ("温度: ", "bold cyan"),
                (str(self.temperature), "cyan"),
            ),
            title="章节生成配置",
            border_style="blue",
        )
        console.print(panel)

        if self.characters:
            char_table = Table(title="角色档案", style="cyan")
            char_table.add_column("角色名")
            char_table.add_column("描述")
            for name, data in self.characters.items():
                desc = (
                    data.get("description", "N/A")[:50] + "..."
                    if len(data.get("description", "")) > 50
                    else data.get("description", "N/A")
                )
                char_table.add_row(name, desc)
            console.print(char_table)


def parse_args() -> argparse.Namespace:
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="章节正文生成器 - 根据大纲和配置生成 LLM 提示词"
    )
    parser.add_argument(
        "--book-dir",
        type=str,
        required=True,
        help="书籍根目录路径",
    )
    parser.add_argument(
        "--chapter",
        type=str,
        required=True,
        help="章节编号",
    )
    parser.add_argument(
        "--outline",
        type=str,
        required=True,
        help="章节大纲文件路径（相对于 book-dir）",
    )
    parser.add_argument(
        "--word-count",
        type=int,
        default=2000,
        help="目标字数（默认: 2000）",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.7,
        help="LLM 温度（0.0-1.0，默认: 0.7）",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="output/prompts.md",
        help="输出文件路径（默认: output/prompts.md）",
    )
    return parser.parse_args()


def main() -> int:
    """主函数"""
    args = parse_args()

    try:
        writer = ChapterWriter(
            book_dir=args.book_dir,
            chapter=args.chapter,
            outline=args.outline,
            word_count=args.word_count,
            temperature=args.temperature,
        )

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            progress.add_task("加载风格配置...", total=None)
            writer.load_style_config()

            progress.add_task("加载角色档案...", total=None)
            writer.load_characters()

            progress.add_task("加载章节大纲...", total=None)
            writer.load_outline()

        writer.display_summary()

        output_path = Path(args.output).resolve()
        writer.write_output(output_path)

        console.print("\n[green]✅ 提示词生成完成![/green]\n")
        return 0

    except NovelWriterError as e:
        console.print(f"\n[red]❌ 错误: {e}[/red]\n")
        logger.exception(e)
        return 1
    except Exception as e:
        console.print(f"\n[red]❌ 未预期的错误: {e}[/red]\n")
        logger.exception(e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
