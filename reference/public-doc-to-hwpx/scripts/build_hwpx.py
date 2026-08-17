"""
build_hwpx.py
────────────────────────────────────────────────────────────
HWPX 조립 (두 가지 베이스 모드 지원)

[모드 A] Skeleton 베이스 (기존 v3.0.1 동작)
  - templates/_skeleton.hwpx 의 메타파일을 그대로 사용
  - 사용자가 제공한 header.xml + section0.xml 만 교체
  - 폰트·글자속성은 --header 파일에 정의된 것이 적용됨

[모드 B] Base HWPX 베이스 (v3.1.0 신규)
  - --base-hwpx 로 받은 양식 hwpx (예: templates/format_1p/standard.hwpx) 의
    모든 메타파일(header.xml 포함)을 그대로 사용
  - section0.xml 만 새로 교체
  - 결과: 양식의 폰트·글자속성(charPr)·문단속성·테두리채움 정의가 100% 보존됨
  - header.xml 별도 지정 불필요 (--header 무시됨)

언제 어느 모드?
  - --base-hwpx 가 주어지면 모드 B (우선)
  - 그렇지 않고 --header 가 주어지면 모드 A
  - 둘 다 없으면 에러

이전 v2 의 6가지 한컴 호환성 문제는 v3.0.1 의 Skeleton 베이스 도입으로 해결됨.
이번 v3.1.0 의 Base HWPX 베이스는 그 위에 "양식의 시각적 정체성(폰트 등) 보존"
이라는 한 단계를 더 쌓는 방식이다.

사용법:
  # 모드 A (Skeleton 베이스)
  python build_hwpx.py \\
    --header templates/government/header.xml \\
    --section /tmp/section0.xml \\
    --title "문서 제목" \\
    --output result.hwpx

  # 모드 B (양식 hwpx 베이스 - 권장)
  python build_hwpx.py \\
    --base-hwpx templates/format_1p/standard.hwpx \\
    --section /tmp/section0.xml \\
    --title "문서 제목" \\
    --output result.hwpx
────────────────────────────────────────────────────────────
"""

import re
import tempfile
import zipfile
import argparse
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_SKELETON = SKILL_DIR / 'templates' / '_skeleton.hwpx'


def _safe_title(title: str) -> str:
    return (
        title.replace('&', '&amp;')
             .replace('<', '&lt;')
             .replace('>', '&gt;')
             .replace('"', '&quot;')
    )


def _update_title_in_hpf(hpf_path: Path, safe_title: str) -> None:
    if not hpf_path.exists() or not safe_title:
        return
    hpf = hpf_path.read_text(encoding='utf-8')
    new_hpf = re.sub(
        r'<opf:title\s*/\s*>',
        f'<opf:title>{safe_title}</opf:title>',
        hpf,
        count=1,
    )
    new_hpf = re.sub(
        r'<opf:title>[^<]*</opf:title>',
        f'<opf:title>{safe_title}</opf:title>',
        new_hpf,
        count=1,
    )
    hpf_path.write_text(new_hpf, encoding='utf-8')


def _repack_hwpx(workdir: Path, output_path: str) -> None:
    """mimetype 은 반드시 첫 번째 + ZIP_STORED."""
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        mimetype_path = workdir / 'mimetype'
        if mimetype_path.exists():
            zf.write(mimetype_path, 'mimetype', compress_type=zipfile.ZIP_STORED)
        for f in sorted(workdir.rglob('*')):
            if f.is_file() and f.name != 'mimetype':
                arc = f.relative_to(workdir).as_posix()
                zf.write(f, arc, compress_type=zipfile.ZIP_DEFLATED)


def build_hwpx(header_path: str = '',
               section_path: str = '',
               output_path: str = '',
               title: str = '',
               skeleton_path: str = '',
               base_hwpx: str = '') -> str:
    """
    HWPX 조립. base_hwpx 가 주어지면 모드 B (양식 hwpx 베이스),
    그렇지 않으면 모드 A (Skeleton + header.xml 교체).
    """
    if not section_path:
        raise ValueError('section_path 는 필수입니다.')
    if not output_path:
        raise ValueError('output_path 는 필수입니다.')

    section_xml = Path(section_path).read_text(encoding='utf-8')
    safe_title = _safe_title(title)

    use_base_mode = bool(base_hwpx)
    if use_base_mode:
        base = Path(base_hwpx)
        if not base.exists():
            raise FileNotFoundError(f'base_hwpx 없음: {base}')
    else:
        skel = Path(skeleton_path) if skeleton_path else DEFAULT_SKELETON
        if not skel.exists():
            raise FileNotFoundError(
                f'Skeleton.hwpx 없음: {skel}\n'
                'templates/_skeleton.hwpx 가 누락됐습니다.'
            )
        if not header_path:
            raise ValueError(
                '모드 A (Skeleton 베이스) 에서는 --header 가 필수입니다. '
                '양식 hwpx 를 베이스로 쓰려면 --base-hwpx 를 사용하세요.'
            )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        source = base if use_base_mode else skel
        with zipfile.ZipFile(source, 'r') as zf:
            zf.extractall(tmp)

        if not use_base_mode:
            header_xml = Path(header_path).read_text(encoding='utf-8')
            (tmp / 'Contents' / 'header.xml').write_text(header_xml, encoding='utf-8')

        (tmp / 'Contents' / 'section0.xml').write_text(section_xml, encoding='utf-8')
        _update_title_in_hpf(tmp / 'Contents' / 'content.hpf', safe_title)
        _repack_hwpx(tmp, output_path)

    mode_label = 'Base HWPX' if use_base_mode else 'Skeleton'
    print(f'[build_hwpx] ✅ 조립 완료: {output_path} ({mode_label} 베이스)')
    return output_path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='HWPX 파일 조립 (Skeleton / Base HWPX 두 모드)')
    parser.add_argument('--header', default='',
                        help='[모드 A] header.xml 경로 (--base-hwpx 없을 때 필수)')
    parser.add_argument('--section', required=True, help='section0.xml 경로')
    parser.add_argument('--output', required=True, help='출력 .hwpx 경로')
    parser.add_argument('--title', default='', help='문서 제목')
    parser.add_argument('--skeleton', default='',
                        help='[모드 A] Skeleton.hwpx 경로 (기본: templates/_skeleton.hwpx)')
    parser.add_argument('--base-hwpx', dest='base_hwpx', default='',
                        help='[모드 B] 양식 hwpx 경로 (지정 시 폰트·서식 100% 보존)')
    args = parser.parse_args()
    build_hwpx(
        header_path=args.header,
        section_path=args.section,
        output_path=args.output,
        title=args.title,
        skeleton_path=args.skeleton,
        base_hwpx=args.base_hwpx,
    )
