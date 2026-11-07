import { PET_SCENES } from './pet-ensemble-catalog'
import { greetingStory } from './pet-story-greetings'
import { gameStory } from './pet-story-games'
import { workStory } from './pet-story-work'
import { lifeStory } from './pet-story-life'
import { body, clamp, makeStoryContext, type StoryFrame, type StoryInput } from './pet-story-types'

/** Each scene has its own preparation, action, response and resolution. */
export function samplePetStory(input: StoryInput): StoryFrame {
  const context = makeStoryContext(input)
  greetingStory(context)
  gameStory(context)
  workStory(context)
  lifeStory(context)
  for (const actor of context.actors) {
    const halfWidth = body(actor) / 2, halfHeight = halfWidth * 208 / 192
    actor.x = clamp(actor.x, halfWidth + 5, input.width - halfWidth - 5)
    actor.y = clamp(actor.y, halfHeight + 34 + actor.lift, input.height - halfHeight - 8)
  }
  for (const prop of context.props) {
    prop.x = clamp(prop.x, prop.size * .36 + 5, input.width - prop.size * .36 - 5)
    prop.y = clamp(prop.y, 34 + prop.size * .32, input.height - prop.size * .34 - 5)
  }
  return { actors: context.actors, props: context.props,
    beat: context.beat[0] ? context.beat : PET_SCENES[input.scene].title }
}
